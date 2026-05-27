import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  ClosePurchaseDto,
  ClosePurchaseResponse,
  CreatePurchaseDto,
  GoodsReceiptItemResponse,
  GoodsReceiptResponse,
  ListPurchaseTransactionLogQueryDto,
  ListPurchasesQueryDto,
  PurchaseOrderDetailResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  PurchaseOrderStatusDto,
  PurchaseSummaryResponse,
  PurchaseTransactionLogResponse,
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
  UpdatePurchaseDto,
  UpdatePurchaseStatusDto,
} from "./dto/purchases.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { tenantWhere } from "@/common/utils/tenant";
import {
  PurchasesRepository,
  PO_DETAIL_SELECT,
  type RawPO,
  type RawPODetail,
  type RawReceipt,
} from "./purchases.repository";
import { PurchaseReceiveService } from "./purchase-receive.service";
import { toPurchaseResponse, toPurchaseDetailResponse, toReceiptResponse } from "./purchases.helpers";
export { toPurchaseResponse, toPurchaseDetailResponse, toReceiptResponse };

const ALLOWED_TRANSITIONS: Record<
  PurchaseOrderStatusDto,
  PurchaseOrderStatusDto[]
> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PurchasesRepository,
    private readonly purchaseReceive: PurchaseReceiveService,
    private readonly assert: AssertService,
  ) {}

  async list(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PaginatedResponse<PurchaseOrderResponse>> {
    const where = this.buildListWhere(companyId, query);
    const { page, perPage } = query;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toPurchaseResponse), total, page, perPage);
  }

  async summary(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseSummaryResponse> {
    const where = this.buildListWhere(companyId, query);

    const [agg, byStatus] = await Promise.all([
      this.repo.aggregate(where),
      this.repo.groupByStatus(where),
    ]);

    return {
      totalCount: agg._count._all,
      totalAmount: agg._sum.totalAmount ?? 0,
      byStatus: byStatus.map((row) => ({
        status: row.status as PurchaseOrderStatusDto,
        count: row._count._all,
        totalAmount: row._sum.totalAmount ?? 0,
      })),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const po = await this.repo.findById(companyId, id);
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    return toPurchaseDetailResponse(po);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseDto,
    retryCount = 0,
  ): Promise<PurchaseOrderDetailResponse> {
    await this.assert.supplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
    const orderNumber = await this.repo.nextOrderNumber(companyId);
    const purchaseTransactionNumber =
      await this.repo.nextPurchaseTransactionNumber(companyId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            purchaseTransactionNumber,
            supplierId: dto.supplierId,
            branchId: dto.branchId ?? null,
            companyId,
            status: "DRAFT",
            totalAmount,
            notes: dto.notes ?? null,
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
            createdBy: userId,
            items: {
              create: dto.items.map((it) => ({
                productId: it.productId,
                unitId: it.unitId ?? null,
                variantId: it.variantId ?? null,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
              })),
            },
          },
          select: { id: true },
        });

        // Log row pertama: status DRAFT dengan no transaksi = BL number.
        await tx.purchaseTransactionLog.create({
          data: {
            companyId,
            branchId: dto.branchId ?? null,
            purchaseOrderId: po.id,
            documentNumber: purchaseTransactionNumber,
            documentType: "BL",
            status: "DRAFT",
            amount: totalAmount,
            createdBy: userId,
          },
        });

        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: po.id },
          select: PO_DETAIL_SELECT,
        });
      });

      return toPurchaseDetailResponse(created);
    } catch (err) {
      if (isOrderNumberConflict(err) && retryCount < 3) {
        return this.create(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.repo.findByIdForUpdate(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT" && existing.status !== "ORDERED") {
      throw new BadRequestException(
        "Purchase order hanya bisa diubah saat status DRAFT atau ORDERED",
      );
    }

    if (dto.supplierId) await this.assert.supplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (dto.supplierId !== undefined) {
        data.supplier = { connect: { id: dto.supplierId } };
      }
      if (dto.branchId !== undefined) {
        data.branch = dto.branchId
          ? { connect: { id: dto.branchId } }
          : { disconnect: true };
      }
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.expectedDate !== undefined) {
        data.expectedDate = dto.expectedDate
          ? new Date(dto.expectedDate)
          : null;
      }

      if (dto.items) {
        const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
        data.totalAmount = totalAmount;
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((it) => ({
            purchaseOrderId: id,
            productId: it.productId,
            unitId: it.unitId ?? null,
            variantId: it.variantId ?? null,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
          })),
        });
      }

      await tx.purchaseOrder.update({ where: { id }, data });

      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        select: PO_DETAIL_SELECT,
      });
    });

    return toPurchaseDetailResponse(updated);
  }

  async updateStatus(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdatePurchaseStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.repo.findByIdForStatusUpdate(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");

    const current = existing.status as PurchaseOrderStatusDto;
    const next = dto.status;
    if (current === next) {
      throw new BadRequestException(`Status sudah ${current}`);
    }
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Transisi status dari ${current} ke ${next} tidak diizinkan`,
      );
    }

    const data: Prisma.PurchaseOrderUpdateInput = { status: next };
    if (next === "RECEIVED") data.receivedDate = new Date();
    if (next === "CLOSED") data.closedDate = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data });
      // Log perubahan status: docNumber tetap PO number untuk transisi
      // status biasa (ORDERED/CANCELLED).
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: existing.branchId,
          purchaseOrderId: id,
          documentNumber: existing.orderNumber,
          documentType: "PO",
          status: next,
          amount: existing.totalAmount,
          createdBy: userId,
        },
      });
    });

    const refreshed = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: PO_DETAIL_SELECT,
    });
    return toPurchaseDetailResponse(refreshed);
  }

  async receive(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseDto,
  ): Promise<ReceivePurchaseResponse> {
    return this.purchaseReceive.receive(companyId, userId, id, dto);
  }

  async close(
    companyId: string,
    userId: string,
    id: string,
    dto: ClosePurchaseDto,
  ): Promise<ClosePurchaseResponse> {
    const po = await this.repo.findByIdForClose(companyId, id);
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    if (po.status !== "PARTIAL") {
      throw new BadRequestException(
        "Hanya PO berstatus PARTIAL yang dapat ditutup",
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Append discrepancy/closing notes onto the PO record.
      const closingNote = (dto.discrepancyNote ?? "").trim();
      const composedNotes = closingNote
        ? po.notes
          ? `${po.notes}\n[CLOSED] ${closingNote}`
          : `[CLOSED] ${closingNote}`
        : po.notes;

      // Locate any open supplier debt(s) tied to this PO so we can adjust.
      const debts = await tx.debt.findMany({
        where: {
          referenceType: "PURCHASE",
          referenceId: id,
          status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
        },
        select: {
          id: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
        },
        orderBy: { createdAt: "desc" },
      });

      let debtAdjusted = false;
      let firstDebtId: string | null = debts[0]?.id ?? null;
      let firstDebtBefore: number | null = debts[0]?.remainingAmount ?? null;
      let firstDebtAfter: number | null = debts[0]?.remainingAmount ?? null;

      if (dto.adjustDebt && debts.length > 0) {
        // Total receivable adjustment = totalAmount - receivedAmount.
        // Distribute the reduction across open debts (newest first).
        let pendingReduction = Math.max(po.totalAmount - po.receivedAmount, 0);

        for (const d of debts) {
          if (pendingReduction <= 0) break;
          const reduce = Math.min(pendingReduction, d.remainingAmount);
          const newTotal = Math.max(d.totalAmount - reduce, d.paidAmount);
          const newRemaining = Math.max(newTotal - d.paidAmount, 0);
          const newStatus =
            newRemaining <= 0
              ? "PAID"
              : d.paidAmount > 0
                ? "PARTIAL"
                : "UNPAID";

          await tx.debt.update({
            where: { id: d.id },
            data: {
              totalAmount: newTotal,
              remainingAmount: newRemaining,
              status: newStatus,
            },
          });
          if (d.id === firstDebtId) {
            firstDebtAfter = newRemaining;
          }
          pendingReduction -= reduce;
          debtAdjusted = true;
        }
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedDate: new Date(),
          closingNotes: closingNote || null,
          notes: composedNotes,
        },
      });

      // Log: status CLOSED dgn docNumber tetap PO number.
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: po.branchId,
          purchaseOrderId: id,
          documentNumber: po.orderNumber,
          documentType: "PO",
          status: "CLOSED",
          amount: po.receivedAmount,
          ...(closingNote ? { note: closingNote } : {}),
          createdBy: userId,
        },
      });
      // Log: COMPLETED dgn BL number (purchaseTransactionNumber dari create).
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: po.branchId,
          purchaseOrderId: id,
          documentNumber: po.purchaseTransactionNumber,
          documentType: "BL",
          status: "COMPLETED",
          amount: po.receivedAmount,
          createdBy: userId,
        },
      });

      const refreshed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        select: PO_DETAIL_SELECT,
      });

      return {
        purchaseOrder: refreshed,
        debtAdjusted,
        debtId: firstDebtId,
        debtRemainingBefore: firstDebtBefore,
        debtRemainingAfter: firstDebtAfter,
      };
    });

    return {
      purchaseOrder: toPurchaseDetailResponse(result.purchaseOrder),
      debtAdjusted: result.debtAdjusted,
      debtId: result.debtId,
      debtRemainingBefore: result.debtRemainingBefore,
      debtRemainingAfter: result.debtRemainingAfter,
    };
  }

  async listTransactionLog(
    companyId: string,
    query: ListPurchaseTransactionLogQueryDto,
  ): Promise<PaginatedResponse<PurchaseTransactionLogResponse>> {
    const where: Prisma.PurchaseTransactionLogWhereInput = { companyId };
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.documentType) where.documentType = query.documentType;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search, mode: "insensitive" } },
        {
          purchaseOrder: {
            orderNumber: { contains: query.search, mode: "insensitive" },
          },
        },
        {
          purchaseOrder: {
            supplier: {
              name: { contains: query.search, mode: "insensitive" },
            },
          },
        },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findTransactionLogs(
        where,
        (query.page - 1) * query.perPage,
        query.perPage,
      ),
      this.repo.countTransactionLogs(where),
    ]);

    // Enrich branch + user.
    const branchIds = Array.from(
      new Set(rows.map((r) => r.branchId).filter((b): b is string => !!b)),
    );
    const userIds = Array.from(
      new Set(rows.map((r) => r.createdBy).filter((u): u is string => !!u)),
    );
    const [branches, users] = await Promise.all([
      branchIds.length > 0
        ? this.repo.findBranchesByIds(companyId, branchIds)
        : Promise.resolve([] as { id: string; name: string }[]),
      userIds.length > 0
        ? this.repo.findUsersByIds(userIds)
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const branchMap = new Map(branches.map((b) => [b.id, b]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const logs: PurchaseTransactionLogResponse[] = rows.map((r) => ({
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      purchaseOrder: r.purchaseOrder
        ? {
            id: r.purchaseOrder.id,
            orderNumber: r.purchaseOrder.orderNumber,
            purchaseTransactionNumber:
              r.purchaseOrder.purchaseTransactionNumber ?? null,
          }
        : null,
      branchId: r.branchId,
      branch: r.branchId ? (branchMap.get(r.branchId) ?? null) : null,
      documentNumber: r.documentNumber,
      documentType: r.documentType,
      status: r.status,
      amount: r.amount,
      note: r.note,
      createdBy: r.createdBy,
      createdByUser: r.createdBy ? (userMap.get(r.createdBy) ?? null) : null,
      supplier: r.purchaseOrder?.supplier ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return paginate(logs, total, query.page, query.perPage);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findByIdForDelete(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya purchase order dengan status DRAFT yang bisa dihapus",
      );
    }
    if (existing._count.goodsReceipts > 0) {
      throw new BadRequestException(
        "Purchase order yang sudah memiliki penerimaan tidak bisa dihapus",
      );
    }
    await this.repo.deletePurchaseOrder(id);
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const { search, status, supplierId, branchId, from, to } = query;
    const where: Prisma.PurchaseOrderWhereInput = tenantWhere(companyId, "direct", "supplier", "branch");
    if (status) {
      const statuses = typeof status === "string" && status.includes(",")
        ? status.split(",").map((s) => s.trim())
        : Array.isArray(status) ? status : [status];
      where.status = statuses.length > 1
        ? { in: statuses as Prisma.EnumPurchaseOrderStatusFilter["in"] }
        : (statuses[0] as Prisma.EnumPurchaseOrderStatusFilter);
    }
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        {
          supplier: {
            name: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }
    if (from || to) {
      where.orderDate = {};
      if (from) where.orderDate.gte = new Date(from);
      if (to) where.orderDate.lte = new Date(to);
    }
    return where;
  }

}

function isOrderNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      if (
        target.includes("orderNumber") ||
        target.includes("purchaseTransactionNumber")
      ) {
        return true;
      }
    }
  }
  return false;
}

