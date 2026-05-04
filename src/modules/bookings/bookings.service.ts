import {
  BadRequestException,
  Injectable,
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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.toResponse(updated);
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
