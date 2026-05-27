import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PaymentMethod } from "@prisma/client";
import type {
  CreateServiceOrderDto,
  FinalizeServiceOrderDto,
  ListServiceOrdersQueryDto,
  ServiceOrderItemResponse,
  ServiceOrderListResponse,
  ServiceOrderResponse,
  ServiceOrderStatus,
  TransitionStatusDto,
  UpdateServiceOrderDto,
} from "./dto/service-order.dto";
import {
  dayRange,
  nextDocumentNumber,
} from "@/common/utils/document-number";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import {
  ServiceOrdersRepository,
  type RawServiceOrder,
} from "./service-orders.repository";

// Estimasi tanggal service berikutnya berdasar item-item yang dikerjakan.
// Aturan ini mirror frontend di `service-order-print.ts` agar UI dan reminder
// WA punya patokan yang sama.
//   - oli mesin / ganti oli                   → 60 hari
//   - tune up / servis berkala / overhaul     → 90 hari
//   - kampas rem / aki / busi / filter        → 120 hari
//   - default                                 → 90 hari
function estimateNextServiceDate(
  items: { name: string }[],
  baseDate: Date,
): Date {
  let intervalDays = 90;
  const lower = items.map((i) => i.name.toLowerCase());
  const has = (kw: string) => lower.some((n) => n.includes(kw));
  if (has("oli mesin") || has("ganti oli") || (has("oli") && !has("oli rem"))) {
    intervalDays = 60;
  } else if (has("tune up") || has("tune-up") || has("servis berkala") || has("overhaul")) {
    intervalDays = 90;
  } else if (has("kampas rem") || has("aki") || has("busi") || has("filter")) {
    intervalDays = 120;
  }
  return new Date(baseDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

const VALID_TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  ANTRIAN: ["DIAGNOSA", "DIBATALKAN"],
  DIAGNOSA: ["MENUNGGU_APPROVAL", "DIKERJAKAN", "DIBATALKAN"],
  MENUNGGU_APPROVAL: ["DIKERJAKAN", "DIBATALKAN"],
  DIKERJAKAN: ["SELESAI", "DIBATALKAN"],
  SELESAI: ["DIBAYAR"],
  DIBAYAR: [],
  DIBATALKAN: [],
};

@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly repo: ServiceOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Public list untuk queue display di TV bengkel. No auth — caller pass
   * companyId + branchId di URL. Return field minimum yang relevan untuk
   * display: tidak ada estimateAmount, finalAmount, mileage, dll. Termasuk
   * status DIBAYAR yang baru lewat 30 menit (recent pickup).
   */
  async publicQueue(companyId: string, branchId: string) {
    const RECENTLY_DONE_MS = 30 * 60 * 1000;
    const recentCutoff = new Date(Date.now() - RECENTLY_DONE_MS);
    const items = await this.repo.findPublicQueue(companyId, branchId, recentCutoff);
    return { items };
  }

  async list(
    companyId: string,
    query: ListServiceOrdersQueryDto,
  ): Promise<ServiceOrderListResponse> {
    const { search, status, branchId, vehicleId, customerId, mechanicId, page, limit } =
      query;
    const where: Prisma.ServiceOrderWhereInput = { companyId };
    if (status) where.status = status;
    if (branchId) where.branchId = branchId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (customerId) where.customerId = customerId;
    if (mechanicId) where.mechanicId = mechanicId;
    if (search) {
      const q = search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { complaint: { contains: q, mode: "insensitive" } },
        { vehicle: { plateNumber: { contains: q, mode: "insensitive" } } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.repo.count(where),
      this.repo.findMany(where, (page - 1) * limit, limit),
    ]);
    return {
      items: items.map(toResponse),
      total,
      page,
      limit,
    };
  }

  async findById(companyId: string, id: string): Promise<ServiceOrderResponse> {
    const so = await this.repo.findOne({ id, companyId });
    if (!so) throw new NotFoundException("Service order tidak ditemukan");
    return toResponse(so);
  }

  async create(
    companyId: string,
    dto: CreateServiceOrderDto,
  ): Promise<ServiceOrderResponse> {
    // Validate vehicle, customer, branch belong to company
    const [vehicle, customer, branch] = await Promise.all([
      this.repo.findVehicle(companyId, dto.vehicleId),
      this.repo.findCustomer(companyId, dto.customerId),
      this.repo.findBranch(companyId, dto.branchId),
    ]);
    if (!vehicle) throw new NotFoundException("Kendaraan tidak ditemukan");
    if (!customer) throw new NotFoundException("Customer tidak ditemukan");
    if (!branch) throw new NotFoundException("Branch tidak ditemukan");

    // Generate orderNumber: SO-YYYYMMDD-NNNN (per company per hari)
    const orderNumber = await this.nextOrderNumber(companyId);

    const items = (dto.items ?? []).map((item) => {
      const subtotal = computeSubtotal(item.quantity, item.unitPrice, item.discount);
      const commissionAmount = item.commissionPct
        ? Math.round((subtotal * item.commissionPct) / 100)
        : 0;
      return {
        productId: item.productId ?? null,
        itemType: item.itemType,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        subtotal,
        mechanicId: item.mechanicId ?? null,
        commissionPct: item.commissionPct,
        commissionAmount,
        notes: item.notes ?? null,
      };
    });

    const created = await this.repo.create({
      orderNumber,
      companyId,
      branchId: dto.branchId,
      vehicleId: dto.vehicleId,
      customerId: dto.customerId,
      mechanicId: dto.mechanicId ?? null,
      complaint: dto.complaint ?? null,
      diagnose: dto.diagnose ?? null,
      estimateAmount: dto.estimateAmount ?? null,
      mileageIn: dto.mileageIn ?? null,
      notes: dto.notes ?? null,
      status: "ANTRIAN",
      items: items.length > 0 ? { create: items } : undefined,
    });

    this.realtime.emit(EVENTS.TRANSACTION_CREATED, {
      type: "service-order",
      id: created.id,
      orderNumber: created.orderNumber,
    });
    this.realtime.emit(EVENTS.SERVICE_ORDER_UPDATED, {
      id: created.id,
      orderNumber: created.orderNumber,
      status: created.status,
      branchId: created.branchId ?? null,
    });

    return toResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateServiceOrderDto,
  ): Promise<ServiceOrderResponse> {
    const existing = await this.repo.findStatus(companyId, id);
    if (!existing) throw new NotFoundException("Service order tidak ditemukan");

    if (existing.status === "DIBAYAR" || existing.status === "DIBATALKAN") {
      throw new BadRequestException(
        `Service order ${existing.status} tidak bisa diubah`,
      );
    }

    const data: Prisma.ServiceOrderUpdateInput = {};
    if (dto.mechanicId !== undefined) {
      data.mechanic = dto.mechanicId
        ? { connect: { id: dto.mechanicId } }
        : { disconnect: true };
    }
    if (dto.complaint !== undefined) data.complaint = dto.complaint;
    if (dto.diagnose !== undefined) data.diagnose = dto.diagnose;
    if (dto.estimateAmount !== undefined) data.estimateAmount = dto.estimateAmount;
    if (dto.mileageIn !== undefined) data.mileageIn = dto.mileageIn;
    if (dto.mileageOut !== undefined) data.mileageOut = dto.mileageOut;
    if (dto.notes !== undefined) data.notes = dto.notes;

    // Replace items kalau dto.items provided
    if (dto.items) {
      await this.repo.deleteItems(id);
      const newItems = dto.items.map((item) => {
        const subtotal = computeSubtotal(item.quantity, item.unitPrice, item.discount);
        const commissionAmount = item.commissionPct
          ? Math.round((subtotal * item.commissionPct) / 100)
          : 0;
        return {
          productId: item.productId ?? null,
          itemType: item.itemType,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal,
          mechanicId: item.mechanicId ?? null,
          commissionPct: item.commissionPct,
          commissionAmount,
          notes: item.notes ?? null,
        };
      });
      data.items = { create: newItems };
    }

    const updated = await this.repo.update(id, data);
    this.realtime.emit(EVENTS.SERVICE_ORDER_UPDATED, {
      id: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      branchId: updated.branchId ?? null,
    });
    return toResponse(updated);
  }

  async transitionStatus(
    companyId: string,
    id: string,
    dto: TransitionStatusDto,
  ): Promise<ServiceOrderResponse> {
    const existing = await this.repo.findStatus(companyId, id);
    if (!existing) throw new NotFoundException("Service order tidak ditemukan");

    const fromStatus = existing.status as ServiceOrderStatus;
    const toStatus = dto.status;
    if (fromStatus === toStatus) {
      throw new BadRequestException("Status sama, tidak ada perubahan");
    }
    const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(
        `Transisi dari ${fromStatus} ke ${toStatus} tidak valid`,
      );
    }
    if (toStatus === "DIBAYAR") {
      throw new BadRequestException(
        "Gunakan endpoint /finalize untuk transisi ke DIBAYAR",
      );
    }

    const data: Prisma.ServiceOrderUpdateInput = { status: toStatus };
    const now = new Date();
    if (toStatus === "MENUNGGU_APPROVAL") data.approvedAt = null;
    if (toStatus === "DIKERJAKAN") {
      data.startedAt = now;
      data.approvedAt = now;
    }
    if (toStatus === "SELESAI") {
      data.completedAt = now;
      if (dto.mileageOut != null) data.mileageOut = dto.mileageOut;
    }
    if (toStatus === "DIBATALKAN") {
      data.cancelledAt = now;
      data.cancelReason = dto.cancelReason ?? null;
    }

    const updated = await this.repo.update(id, data);
    this.realtime.emit(EVENTS.SERVICE_ORDER_UPDATED, {
      id: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      branchId: updated.branchId ?? null,
    });
    return toResponse(updated);
  }

  async finalize(
    companyId: string,
    userId: string,
    id: string,
    dto: FinalizeServiceOrderDto,
  ): Promise<ServiceOrderResponse> {
    const so = await this.repo.findForFinalize(companyId, id);
    if (!so) throw new NotFoundException("Service order tidak ditemukan");
    if (so.transactionId) {
      throw new ConflictException(
        "Service order sudah punya transaksi (DIBAYAR)",
      );
    }
    if (so.status !== "SELESAI" && so.status !== "DIKERJAKAN") {
      throw new BadRequestException(
        `Service order harus berstatus SELESAI/DIKERJAKAN sebelum finalize. Saat ini: ${so.status}`,
      );
    }
    if (so.items.length === 0) {
      throw new BadRequestException("Service order tidak punya item");
    }

    const subtotal = so.items.reduce((sum, it) => sum + it.subtotal, 0);
    const grandTotal = subtotal;
    const paymentAmount = dto.paymentAmount ?? grandTotal;
    if (paymentAmount < grandTotal) {
      throw new BadRequestException("Pembayaran kurang dari total");
    }

    // Generate invoice. invoiceNumber tetap pakai pola SO untuk linkage; display
    // number di-generate sequential per (company, hari) sama dgn POS.
    const invoiceNumber = `INV-SO-${so.orderNumber}`;
    const invoiceDisplayNumber = await this.nextInvoiceDisplayNumber(companyId);

    // $transaction kept in service — repo only handles individual queries
    const result = await this.prisma.$transaction(async (tx) => {
      const trx = await tx.transaction.create({
        data: {
          invoiceNumber,
          invoiceDisplayNumber,
          companyId,
          userId,
          branchId: so.branchId,
          customerId: so.customerId,
          subtotal,
          discountAmount: 0,
          taxAmount: 0,
          grandTotal,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          paymentAmount,
          changeAmount: paymentAmount - grandTotal,
          status: "COMPLETED",
          notes: `Service order: ${so.orderNumber}`,
          items: {
            create: so.items
              .filter((it) => it.productId !== null)
              .map((it) => ({
                productId: it.productId!,
                productName: it.name,
                productCode: "SO-ITEM",
                quantity: it.quantity,
                unitName: it.itemType === "SERVICE" ? "JASA" : "PCS",
                conversionQty: 1,
                baseQty: it.quantity,
                unitPrice: it.unitPrice,
                discount: it.discount,
                subtotal: it.subtotal,
              })),
          },
          payments: {
            create: [
              {
                method: dto.paymentMethod as PaymentMethod,
                amount: paymentAmount,
              },
            ],
          },
        },
      });

      const paidAt = new Date();
      const nextServiceAt = estimateNextServiceDate(so.items, paidAt);
      const updatedSo = await tx.serviceOrder.update({
        where: { id: so.id },
        data: {
          status: "DIBAYAR",
          finalAmount: grandTotal,
          paidAt,
          transactionId: trx.id,
          nextServiceAt,
        },
        select: SO_RAW_SELECT_FOR_FINALIZE,
      });

      // Update vehicle: lastServicedAt + mileage kalau ada
      if (so.mileageOut != null) {
        await tx.vehicle.update({
          where: { id: so.vehicleId },
          data: {
            mileage: so.mileageOut,
            lastServicedAt: new Date(),
          },
        });
      } else {
        await tx.vehicle.update({
          where: { id: so.vehicleId },
          data: { lastServicedAt: new Date() },
        });
      }

      return updatedSo;
    });

    this.realtime.emit(EVENTS.TRANSACTION_CREATED, {
      type: "service-order-finalize",
      id: result.id,
      transactionId: result.transactionId,
    });
    this.realtime.emit(EVENTS.SERVICE_ORDER_UPDATED, {
      id: result.id,
      orderNumber: result.orderNumber,
      status: result.status,
      branchId: result.branchId ?? null,
    });

    return toResponse(result as RawServiceOrder);
  }

  /**
   * Generate display invoice number "INV-DDMMYYYY-NNNNN" sequential per
   * (companyId, date). Sama dengan logika di TransactionsService.
   */
  private async nextInvoiceDisplayNumber(companyId: string): Promise<string> {
    const date = new Date();
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const prefix = `INV-${dd}${mm}${yyyy}-`;
    const last = await this.repo.findLastInvoiceDisplayNumber(companyId, prefix);
    let nextSeq = 1;
    if (last) {
      const tail = last.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
    }
    return `${prefix}${String(nextSeq).padStart(5, "0")}`;
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    const so = await this.repo.findForDelete(companyId, id);
    if (!so) throw new NotFoundException("Service order tidak ditemukan");
    if (so.transactionId) {
      throw new BadRequestException(
        "Tidak bisa hapus — sudah punya transaksi (DIBAYAR)",
      );
    }
    await this.repo.delete(id);
    return { id, deleted: true };
  }

  // SO-YYYYMMDD-NNNN — sequence per company per hari (shared utility).
  private async nextOrderNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "SO",
      countToday: () => this.repo.countOrdersToday(companyId, start, end),
      exists: (candidate) => this.repo.orderNumberExists(companyId, candidate),
    });
  }
}

/**
 * Inline select used inside the $transaction for finalize — mirrors SO_SELECT
 * from the repository so `toResponse` works on the result.
 */
const SO_RAW_SELECT_FOR_FINALIZE = {
  id: true,
  orderNumber: true,
  companyId: true,
  status: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  vehicleId: true,
  vehicle: {
    select: {
      id: true,
      plateNumber: true,
      type: true,
      brand: { select: { id: true, name: true } },
      modelRef: { select: { id: true, name: true } },
    },
  },
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  mechanicId: true,
  mechanic: { select: { id: true, name: true } },
  complaint: true,
  diagnose: true,
  estimateAmount: true,
  finalAmount: true,
  mileageIn: true,
  mileageOut: true,
  approvedAt: true,
  startedAt: true,
  completedAt: true,
  paidAt: true,
  cancelledAt: true,
  cancelReason: true,
  notes: true,
  transactionId: true,
  items: {
    select: {
      id: true,
      productId: true,
      itemType: true,
      name: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      subtotal: true,
      mechanicId: true,
      mechanic: { select: { id: true, name: true } },
      commissionPct: true,
      commissionAmount: true,
      notes: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceOrderSelect;

function computeSubtotal(qty: number, price: number, discount: number): number {
  return Math.max(0, Math.round(qty * price - discount));
}

function toResponse(so: RawServiceOrder): ServiceOrderResponse {
  return {
    id: so.id,
    orderNumber: so.orderNumber,
    status: so.status as ServiceOrderStatus,
    branchId: so.branchId,
    branch: so.branch ? { id: so.branch.id, name: so.branch.name } : null,
    vehicleId: so.vehicleId,
    vehicle: so.vehicle
      ? {
          id: so.vehicle.id,
          plateNumber: so.vehicle.plateNumber,
          type: so.vehicle.type,
          brand: so.vehicle.brand?.name ?? null,
          model: so.vehicle.modelRef?.name ?? null,
        }
      : null,
    customerId: so.customerId,
    customer: so.customer
      ? { id: so.customer.id, name: so.customer.name, phone: so.customer.phone }
      : null,
    mechanicId: so.mechanicId,
    mechanic: so.mechanic ? { id: so.mechanic.id, name: so.mechanic.name } : null,
    complaint: so.complaint,
    diagnose: so.diagnose,
    estimateAmount: so.estimateAmount,
    finalAmount: so.finalAmount,
    mileageIn: so.mileageIn,
    mileageOut: so.mileageOut,
    approvedAt: so.approvedAt?.toISOString() ?? null,
    startedAt: so.startedAt?.toISOString() ?? null,
    completedAt: so.completedAt?.toISOString() ?? null,
    paidAt: so.paidAt?.toISOString() ?? null,
    cancelledAt: so.cancelledAt?.toISOString() ?? null,
    cancelReason: so.cancelReason,
    notes: so.notes,
    transactionId: so.transactionId,
    items: so.items.map(
      (it): ServiceOrderItemResponse => ({
        id: it.id,
        productId: it.productId,
        itemType: it.itemType,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
        subtotal: it.subtotal,
        mechanicId: it.mechanicId,
        mechanic: it.mechanic
          ? { id: it.mechanic.id, name: it.mechanic.name }
          : null,
        commissionPct: it.commissionPct,
        commissionAmount: it.commissionAmount,
        notes: it.notes,
      }),
    ),
    createdAt: so.createdAt.toISOString(),
    updatedAt: so.updatedAt.toISOString(),
  };
}
