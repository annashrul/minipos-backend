import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BookingListResponse,
  BookingResponse,
  BookingStatus,
  BookingType,
  CreateBookingDto,
  ListBookingsQueryDto,
  TransitionBookingStatusDto,
  UpdateBookingDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappReceiptService } from "../whatsapp-receipt/whatsapp-receipt.service";

const BOOKING_INCLUDE = {
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  vehicle: {
    select: {
      id: true,
      plateNumber: true,
      brand: { select: { name: true } },
      modelRef: { select: { name: true } },
    },
  },
  mechanic: { select: { id: true, name: true } },
  table: { select: { id: true, number: true, name: true } },
} satisfies Prisma.BookingInclude;

const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly waReceipt: WhatsappReceiptService,
  ) {}

  async list(
    companyId: string,
    query: ListBookingsQueryDto,
  ): Promise<BookingListResponse> {
    const { search, branchId, bookingType, status, dateFrom, dateTo, page, limit } =
      query;

    const where: Prisma.BookingWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    if (bookingType) where.bookingType = bookingType;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.scheduledAt = {};
      if (dateFrom) where.scheduledAt.gte = new Date(dateFrom);
      if (dateTo) where.scheduledAt.lte = new Date(dateTo);
    }
    if (search) {
      const q = search.trim();
      where.OR = [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { vehicle: { plateNumber: { contains: q, mode: "insensitive" } } },
        { serviceType: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { scheduledAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: items.map((b) => this.toResponse(b)),
      total,
      page,
      limit,
    };
  }

  async findById(companyId: string, id: string): Promise<BookingResponse> {
    const b = await this.prisma.booking.findFirst({
      where: { id, companyId },
      include: BOOKING_INCLUDE,
    });
    if (!b) throw new NotFoundException("Booking tidak ditemukan");
    return this.toResponse(b);
  }

  // Hitung total per status (mengabaikan filter status — supaya pill counter
  // konsisten saat user memilih satu status). Filter cabang/tanggal/search
  // tetap dihormati.
  async stats(
    companyId: string,
    query: Omit<ListBookingsQueryDto, "status" | "page" | "limit">,
  ): Promise<{ total: number; byStatus: Record<string, number> }> {
    const { search, branchId, bookingType, dateFrom, dateTo } = query;
    const where: Prisma.BookingWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    if (bookingType) where.bookingType = bookingType;
    if (dateFrom || dateTo) {
      where.scheduledAt = {};
      if (dateFrom) where.scheduledAt.gte = new Date(dateFrom);
      if (dateTo) where.scheduledAt.lte = new Date(dateTo);
    }
    if (search) {
      const q = search.trim();
      where.OR = [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { vehicle: { plateNumber: { contains: q, mode: "insensitive" } } },
        { serviceType: { contains: q, mode: "insensitive" } },
      ];
    }

    const groups = await this.prisma.booking.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const g of groups) {
      const c = g._count._all;
      byStatus[g.status] = c;
      total += c;
    }
    return { total, byStatus };
  }

  async create(
    companyId: string,
    dto: CreateBookingDto,
    userId: string | null,
  ): Promise<BookingResponse> {
    // Verifikasi branch milik company
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch tidak ditemukan");

    // Verifikasi customer (jika dipilih)
    if (dto.customerId) {
      const c = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException("Customer tidak ditemukan");
    }

    // Verifikasi vehicle (bengkel)
    if (dto.vehicleId) {
      const v = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId },
        select: { id: true },
      });
      if (!v) throw new NotFoundException("Kendaraan tidak ditemukan");
    }

    const created = await this.prisma.booking.create({
      data: {
        companyId,
        branchId: dto.branchId,
        bookingType: dto.bookingType,
        scheduledAt: new Date(dto.scheduledAt),
        durationMin: dto.durationMin ?? null,
        notes: dto.notes ?? null,
        customerId: dto.customerId ?? null,
        customerName: dto.customerName ?? null,
        customerPhone: dto.customerPhone ?? null,
        vehicleId: dto.vehicleId ?? null,
        serviceType: dto.serviceType ?? null,
        mechanicId: dto.mechanicId ?? null,
        partySize: dto.partySize ?? null,
        tableId: dto.tableId ?? null,
        createdById: userId,
      },
      include: BOOKING_INCLUDE,
    });
    return this.toResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateBookingDto,
  ): Promise<BookingResponse> {
    const existing = await this.prisma.booking.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Booking tidak ditemukan");
    if (
      existing.status === "COMPLETED" ||
      existing.status === "CANCELLED" ||
      existing.status === "NO_SHOW"
    ) {
      throw new BadRequestException(
        "Booking sudah final, tidak bisa diubah. Buat booking baru.",
      );
    }

    const data: Prisma.BookingUpdateInput = {};
    if (dto.branchId) data.branch = { connect: { id: dto.branchId } };
    if (dto.bookingType) data.bookingType = dto.bookingType;
    if (dto.scheduledAt) data.scheduledAt = new Date(dto.scheduledAt);
    if (dto.durationMin !== undefined) data.durationMin = dto.durationMin;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.customerName !== undefined) data.customerName = dto.customerName;
    if (dto.customerPhone !== undefined) data.customerPhone = dto.customerPhone;
    if (dto.serviceType !== undefined) data.serviceType = dto.serviceType;
    if (dto.partySize !== undefined) data.partySize = dto.partySize;
    if (dto.cancelReason !== undefined) data.cancelReason = dto.cancelReason;
    if (dto.customerId !== undefined) {
      data.customer = dto.customerId
        ? { connect: { id: dto.customerId } }
        : { disconnect: true };
    }
    if (dto.vehicleId !== undefined) {
      data.vehicle = dto.vehicleId
        ? { connect: { id: dto.vehicleId } }
        : { disconnect: true };
    }
    if (dto.mechanicId !== undefined) {
      data.mechanic = dto.mechanicId
        ? { connect: { id: dto.mechanicId } }
        : { disconnect: true };
    }
    if (dto.tableId !== undefined) {
      data.table = dto.tableId
        ? { connect: { id: dto.tableId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data,
      include: BOOKING_INCLUDE,
    });
    return this.toResponse(updated);
  }

  async transition(
    companyId: string,
    id: string,
    dto: TransitionBookingStatusDto,
  ): Promise<BookingResponse> {
    const existing = await this.prisma.booking.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Booking tidak ditemukan");

    const allowed = VALID_TRANSITIONS[existing.status as BookingStatus];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Tidak bisa transisi dari ${existing.status} ke ${dto.status}`,
      );
    }

    const data: Prisma.BookingUpdateInput = { status: dto.status };
    if (dto.status === "CANCELLED" || dto.status === "NO_SHOW") {
      data.cancelledAt = new Date();
      if (dto.cancelReason) data.cancelReason = dto.cancelReason;
    }
    if (dto.status === "COMPLETED") {
      data.completedAt = new Date();
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data,
      include: BOOKING_INCLUDE,
    });

    // Kirim WA konfirmasi ke customer ketika status di-set ke CONFIRMED.
    // Fire-and-forget — kalau WA session belum aktif / nomor invalid,
    // booking transition tetap sukses; admin lihat error di log/UI manual.
    if (dto.status === "CONFIRMED") {
      void this.sendConfirmationWa(companyId, updated).catch((err) => {
        this.logger.warn(
          `[booking ${id}] WA konfirmasi gagal: ${err instanceof Error ? err.message : err}`,
        );
      });

      // Auto-create Service Order untuk booking BENGKEL — booking yang
      // dikonfirmasi langsung masuk ke antrian service order. Customer +
      // Vehicle di-find-or-create dari data booking.
      if (
        updated.bookingType === "BENGKEL" &&
        !updated.serviceOrderId
      ) {
        try {
          const so = await this.promoteToServiceOrder(companyId, updated);
          if (so) {
            await this.prisma.booking.update({
              where: { id: updated.id },
              data: { serviceOrderId: so.id },
            });
          }
        } catch (err) {
          this.logger.warn(
            `[booking ${id}] auto-create service order gagal: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }

    return this.toResponse(updated);
  }

  /**
   * Promote booking BENGKEL ke ServiceOrder dengan status ANTRIAN.
   * Customer + Vehicle di-find-or-create kalau belum di-link.
   * Dipanggil saat admin konfirmasi booking — flow transaksi service
   * lanjut dari sini (Diagnosa → Dikerjakan → Dibayar).
   */
  private async promoteToServiceOrder(
    companyId: string,
    booking: Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
  ): Promise<{ id: string; orderNumber: string } | null> {
    // Resolve customer — link existing kalau sudah ada, atau buat baru
    // dari customerName + customerPhone.
    let customerId = booking.customerId;
    if (!customerId) {
      if (!booking.customerPhone || !booking.customerName) {
        this.logger.warn(
          `[booking ${booking.id}] tidak bisa promote: customer info tidak lengkap`,
        );
        return null;
      }
      const phone = booking.customerPhone;
      const existing = await this.prisma.customer.findFirst({
        where: { companyId, phone },
        select: { id: true },
      });
      if (existing) {
        customerId = existing.id;
      } else {
        const created = await this.prisma.customer.create({
          data: {
            companyId,
            name: booking.customerName,
            phone: booking.customerPhone,
          },
          select: { id: true },
        });
        customerId = created.id;
      }
    }

    // Resolve vehicle — link existing kalau ada, atau buat baru dari
    // info di notes booking (format: "🚗/🏍️ TYPE · PLATE · BRAND MODEL").
    let vehicleId = booking.vehicleId;
    let parsedComplaint: string | null = null;
    if (!vehicleId) {
      const parsed = parseBookingVehicleInfo(booking.notes);
      parsedComplaint = parsed?.complaint ?? null;
      if (!parsed?.plate) {
        this.logger.warn(
          `[booking ${booking.id}] tidak bisa promote: plat kendaraan tidak ditemukan di notes`,
        );
        return null;
      }
      const plate = parsed.plate.toUpperCase();
      const existing = await this.prisma.vehicle.findFirst({
        where: { companyId, plateNumber: plate },
        select: { id: true },
      });
      if (existing) {
        vehicleId = existing.id;
      } else {
        const created = await this.prisma.vehicle.create({
          data: {
            companyId,
            customerId,
            plateNumber: plate,
            type: parsed.type ?? "MOTOR",
            // brand/model tidak di-set dari free-text — admin bisa link
            // manual ke master setelahnya. notes kendaraan diisi free text
            // untuk audit.
            notes:
              [parsed.brand, parsed.model].filter(Boolean).join(" ") ||
              null,
          },
          select: { id: true },
        });
        vehicleId = created.id;
      }
    }

    // Susun complaint: hanya keluhan parsed (jangan dobel dengan serviceType
    // — serviceType sudah jadi items di bawah, kalau di-stuff ke complaint
    // juga akan duplikat informasi).
    const complaint = parsedComplaint || null;

    // Parse serviceType (mis. "Ganti Oli · Tune Up") jadi list of service
    // items. Public booking join multi-service dengan " · " (U+00B7), tapi
    // toleransi juga `,` dan newline. Tiap item jadi ServiceOrderItem
    // dengan itemType=SERVICE, qty=1, harga=0 (admin isi nanti saat edit SO).
    const serviceItems = (booking.serviceType ?? "")
      .split(/\s*[··]\s*|\s*,\s*|\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({
        itemType: "SERVICE" as const,
        name,
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        subtotal: 0,
        commissionPct: 0,
        commissionAmount: 0,
        mechanicId: booking.mechanicId ?? null,
      }));

    // Generate orderNumber sama format dengan ServiceOrdersService.
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    const orderNumber = `SO-${yy}${mm}${dd}-${rand}`;

    const so = await this.prisma.serviceOrder.create({
      data: {
        orderNumber,
        companyId,
        branchId: booking.branchId,
        vehicleId,
        customerId,
        mechanicId: booking.mechanicId ?? null,
        complaint,
        notes: `Auto-created dari booking ${booking.id.slice(0, 8).toUpperCase()}`,
        status: "ANTRIAN",
        ...(serviceItems.length > 0
          ? { items: { create: serviceItems } }
          : {}),
      },
      select: { id: true, orderNumber: true },
    });

    this.logger.log(
      `[booking ${booking.id}] promoted to service order ${so.orderNumber}`,
    );
    return so;
  }

  /**
   * Kirim pesan WA konfirmasi ke customer setelah admin approve booking.
   * Pakai customerPhone walk-in atau customer.phone master kalau ter-link.
   * Fire-and-forget: tidak block transition flow.
   */
  private async sendConfirmationWa(
    companyId: string,
    booking: Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
  ): Promise<void> {
    const phone = booking.customerPhone ?? booking.customer?.phone ?? null;
    if (!phone) return;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, address: true },
    });

    const customerName = booking.customerName ?? booking.customer?.name ?? "Pelanggan";
    const branchName = booking.branch?.name ?? "—";
    const scheduled = new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(booking.scheduledAt);

    const lines: string[] = [];
    lines.push(`Halo *${customerName}*, 👋`);
    lines.push("");
    lines.push(
      `Booking Anda di *${company?.name ?? "Bengkel kami"}* sudah *DIKONFIRMASI* ✅`,
    );
    lines.push("");
    lines.push("📋 *Detail Booking:*");
    lines.push(`• Kode: ${booking.id.slice(0, 8).toUpperCase()}`);
    lines.push(`• Cabang: ${branchName}`);
    lines.push(`• Jadwal: ${scheduled} WIB`);
    if (booking.serviceType) {
      lines.push(`• Service: ${booking.serviceType}`);
    }
    if (booking.notes) {
      lines.push("");
      lines.push(booking.notes);
    }
    lines.push("");
    lines.push(
      "Mohon datang sesuai jadwal. Kalau ada perubahan, balas pesan ini.",
    );
    if (company?.phone) {
      lines.push("");
      lines.push(`📞 Kontak kami: ${company.phone}`);
    }
    if (company?.address) {
      lines.push(`📍 ${company.address}`);
    }
    lines.push("");
    lines.push("Terima kasih 🙏");

    await this.waReceipt.sendText(companyId, phone, lines.join("\n"));
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.booking.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Booking tidak ditemukan");
    if (existing.status !== "PENDING" && existing.status !== "CANCELLED") {
      throw new BadRequestException(
        "Hanya booking PENDING atau CANCELLED yang bisa dihapus.",
      );
    }
    await this.prisma.booking.delete({ where: { id } });
    return { id, deleted: true };
  }

  private toResponse(
    b: Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
  ): BookingResponse {
    return {
      id: b.id,
      branchId: b.branchId,
      branch: b.branch ? { id: b.branch.id, name: b.branch.name } : null,
      bookingType: b.bookingType as BookingType,
      status: b.status as BookingStatus,
      scheduledAt: b.scheduledAt.toISOString(),
      durationMin: b.durationMin,
      notes: b.notes,
      customerId: b.customerId,
      customer: b.customer
        ? { id: b.customer.id, name: b.customer.name, phone: b.customer.phone }
        : null,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      vehicleId: b.vehicleId,
      vehicle: b.vehicle
        ? {
            id: b.vehicle.id,
            plateNumber: b.vehicle.plateNumber,
            brand: b.vehicle.brand?.name ?? null,
            model: b.vehicle.modelRef?.name ?? null,
          }
        : null,
      serviceType: b.serviceType,
      mechanicId: b.mechanicId,
      mechanic: b.mechanic ? { id: b.mechanic.id, name: b.mechanic.name } : null,
      partySize: b.partySize,
      tableId: b.tableId,
      table: b.table
        ? { id: b.table.id, number: b.table.number, name: b.table.name }
        : null,
      reminderSentAt: b.reminderSentAt?.toISOString() ?? null,
      serviceOrderId: b.serviceOrderId,
      cancelReason: b.cancelReason,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      completedAt: b.completedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }
}


/**
 * Parse string notes booking yang di-generate public-bookings controller:
 *   "🚗 MOBIL · B 1234 ABC · Toyota Avanza"
 *   "💬 Keluhan: ..."
 *
 * Return null kalau format tidak match (mis. notes manual dari admin).
 */
function parseBookingVehicleInfo(notes: string | null | undefined): {
  type: "MOBIL" | "MOTOR" | null;
  plate: string;
  brand: string | null;
  model: string | null;
  complaint: string | null;
} | null {
  if (!notes) return null;
  const lines = notes.split("\n").map((l) => l.trim());
  const vehicleLine = lines.find(
    (l) => l.startsWith("🚗") || l.startsWith("🏍️"),
  );
  const complaintLine = lines.find((l) => l.startsWith("💬"));
  const complaint = complaintLine
    ? complaintLine.replace(/^💬\s*Keluhan:\s*/, "").trim() || null
    : null;

  if (!vehicleLine) return null;
  // Buang ikon awal, split pakai " · "
  const cleaned = vehicleLine.replace(/^[🚗🏍️]\s*/, "");
  const parts = cleaned.split(" · ").map((p) => p.trim());
  if (parts.length < 2) return null;
  const typeRaw = parts[0]?.toUpperCase();
  const type =
    typeRaw === "MOBIL" || typeRaw === "MOTOR" ? typeRaw : null;
  const plate = parts[1] ?? "";
  if (!plate) return null;
  // [2] = "Brand Model" — split kata pertama sebagai brand, sisanya model.
  const brandModel = parts[2] ?? "";
  const [brand, ...modelParts] = brandModel.split(" ");
  const model = modelParts.join(" ").trim() || null;
  return {
    type,
    plate,
    brand: brand || null,
    model,
    complaint,
  };
}
