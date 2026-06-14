import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CashMovementDto,
  CashMovementResponse,
  CloseShiftDto,
  ListShiftsQueryDto,
  OpenShiftDto,
  OpenShiftResponse,
  ShiftDetailResponse,
  ShiftResponse,
  ShiftScheduleNotice,
} from "./dto/shifts.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import {
  ShiftsRepository,
  type RawShift,
  type RawShiftDetail,
} from "./shifts.repository";
import { RealtimeService, EVENTS } from "@/modules/realtime/realtime.service";
import { dateStringInTimeZone, zonedDateToUtc } from "@/common/utils/timezone";

@Injectable()
export class ShiftsService {
  constructor(
    private readonly repo: ShiftsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListShiftsQueryDto,
  ): Promise<PaginatedResponse<ShiftResponse>> {
    const { userId, branchId, isOpen, from, to, page, perPage, sortBy, sortDir } =
      query;
    const where: Prisma.CashierShiftWhereInput = {
      user: { companyId },
    };
    if (userId) where.userId = userId;
    if (branchId) where.branchId = branchId;
    if (isOpen !== undefined) where.isOpen = isOpen;
    if (from || to) {
      where.openedAt = {};
      if (from) where.openedAt.gte = new Date(from);
      if (to) where.openedAt.lte = new Date(to);
    }

    const dir: "asc" | "desc" = sortDir ?? "desc";
    let orderBy: Prisma.CashierShiftOrderByWithRelationInput = {
      openedAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "user":
          orderBy = { user: { name: dir } };
          break;
        case "openedAt":
        case "closedAt":
        case "openingCash":
        case "closingCash":
        case "cashDifference":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.CashierShiftOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toShiftResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ShiftDetailResponse> {
    const shift = await this.repo.findDetail({ id, user: { companyId } });
    if (!shift) throw new NotFoundException("Shift not found");
    return toShiftDetailResponse(shift);
  }

  async getCurrent(
    companyId: string,
    userId: string,
  ): Promise<ShiftDetailResponse | null> {
    const shift = await this.repo.findDetail(
      { userId, isOpen: true, user: { companyId } },
      { openedAt: "desc" },
    );
    return shift ? toShiftDetailResponse(shift) : null;
  }

  async open(
    companyId: string,
    userId: string,
    dto: OpenShiftDto,
  ): Promise<OpenShiftResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const existing = await this.repo.findOne({ userId, isOpen: true });
    if (existing) {
      throw new ConflictException(
        "Shift sudah terbuka, tutup terlebih dahulu sebelum membuka shift baru",
      );
    }

    const created = await this.repo.create({
      userId,
      branchId: dto.branchId ?? null,
      openingCash: dto.openingCash,
      notes: dto.notes ?? null,
    });
    this.realtime.emit(
      EVENTS.SHIFT_OPENED,
      { shiftId: created.id, userId: created.userId },
      created.branchId ?? undefined,
    );

    // Kesesuaian dengan jadwal karyawan (non-blocking — gagal cek tidak
    // membatalkan buka kasir). Auto-confirm jadwal SCHEDULED → CONFIRMED.
    let scheduleNotice: ShiftScheduleNotice | null = null;
    try {
      scheduleNotice = await this.buildScheduleNotice(userId, created.openedAt);
    } catch {
      scheduleNotice = null;
    }

    return { ...toShiftResponse(created), scheduleNotice };
  }

  private async buildScheduleNotice(
    userId: string,
    openedAt: Date,
  ): Promise<ShiftScheduleNotice | null> {
    const dateStr = dateStringInTimeZone(openedAt); // "YYYY-MM-DD" (WIB)
    // Samakan dgn cara jadwal disimpan (parseLocalDate → noon-UTC) agar match
    // persis di kolom @db.Date.
    const dbDate = new Date(`${dateStr}T12:00:00.000Z`);
    const sched = await this.repo.findScheduleForUserOnDate(userId, dbDate);

    if (!sched) {
      return {
        level: "unscheduled",
        scheduled: false,
        message: "Anda tidak terjadwal bekerja hari ini.",
        shiftLabel: null,
        shiftStart: null,
        shiftEnd: null,
        lateMinutes: 0,
      };
    }

    const base = {
      shiftLabel: sched.shiftLabel,
      shiftStart: sched.shiftStart,
      shiftEnd: sched.shiftEnd,
    };

    if (sched.status === "LEAVE" || sched.status === "ABSENT") {
      const label = sched.status === "LEAVE" ? "Cuti" : "Tidak Masuk";
      return {
        level: "off",
        scheduled: false,
        message: `Jadwal Anda hari ini berstatus ${label}.`,
        ...base,
        lateMinutes: 0,
      };
    }

    // SCHEDULED / CONFIRMED → auto-confirm bila masih SCHEDULED.
    if (sched.status === "SCHEDULED") {
      await this.repo.confirmSchedule(sched.id);
    }

    // Hitung keterlambatan dari jam mulai (WIB).
    let lateMinutes = 0;
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = sched.shiftStart.split(":").map(Number);
    if ([y, m, d, hh, mm].every((n) => Number.isFinite(n))) {
      const start = zonedDateToUtc(y!, m!, d!, hh!, mm!);
      lateMinutes = Math.max(
        0,
        Math.round((openedAt.getTime() - start.getTime()) / 60_000),
      );
    }

    if (lateMinutes > 0) {
      return {
        level: "late",
        scheduled: true,
        message: `Terlambat ${lateMinutes} menit dari jadwal (mulai ${sched.shiftStart}).`,
        ...base,
        lateMinutes,
      };
    }

    return {
      level: "on-time",
      scheduled: true,
      message: `Sesuai jadwal (${sched.shiftStart}–${sched.shiftEnd}).`,
      ...base,
      lateMinutes: 0,
    };
  }

  async close(
    companyId: string,
    userId: string,
    id: string,
    dto: CloseShiftDto,
  ): Promise<ShiftResponse> {
    const shift = await this.repo.findForClose({ id, user: { companyId } });
    if (!shift) throw new NotFoundException("Shift not found");
    if (!shift.isOpen) throw new BadRequestException("Shift sudah ditutup");
    if (shift.userId !== userId) {
      throw new BadRequestException("Hanya pemilik shift yang bisa menutup");
    }

    const closedAt = new Date();
    const txWhere: Prisma.TransactionWhereInput = {
      userId: shift.userId,
      status: "COMPLETED",
      paymentMethod: "CASH",
      createdAt: { gte: shift.openedAt, lte: closedAt },
    };
    if (shift.branchId) txWhere.branchId = shift.branchId;

    const [salesAgg, txCount, cashMovements] = await Promise.all([
      this.repo.aggregateTransactions(txWhere),
      this.repo.countTransactions({
        userId: shift.userId,
        status: "COMPLETED",
        createdAt: { gte: shift.openedAt, lte: closedAt },
        ...(shift.branchId ? { branchId: shift.branchId } : {}),
      }),
      this.repo.findCashMovements(id),
    ]);

    const cashSales = salesAgg._sum.grandTotal ?? 0;
    const cashIn = cashMovements
      .filter((m) => m.type === "CASH_IN")
      .reduce((s, m) => s + m.amount, 0);
    const cashOut = cashMovements
      .filter((m) => m.type === "CASH_OUT")
      .reduce((s, m) => s + m.amount, 0);
    const expectedCash = shift.openingCash + cashSales + cashIn - cashOut;
    const cashDifference = dto.closingCash - expectedCash;

    const updated = await this.repo.update(id, {
      closedAt,
      closingCash: dto.closingCash,
      expectedCash,
      cashDifference,
      totalSales: cashSales,
      totalTransactions: txCount,
      notes: dto.notes ?? undefined,
      isOpen: false,
    });
    this.realtime.emit(
      EVENTS.SHIFT_CLOSED,
      { shiftId: updated.id, userId: updated.userId },
      updated.branchId ?? undefined,
    );
    return toShiftResponse(updated);
  }

  async addMovement(
    companyId: string,
    userId: string,
    shiftId: string,
    dto: CashMovementDto,
  ): Promise<CashMovementResponse> {
    const shift = await this.repo.findForClose({
      id: shiftId,
      user: { companyId },
    });
    if (!shift) throw new NotFoundException("Shift not found");
    if (!shift.isOpen) {
      throw new BadRequestException("Shift sudah ditutup");
    }
    if (shift.userId !== userId) {
      throw new BadRequestException(
        "Hanya pemilik shift yang bisa menambah cash movement",
      );
    }

    const movement = await this.repo.createCashMovement({
      shiftId,
      type: dto.type,
      amount: dto.amount,
      reason: dto.reason,
      reference: dto.reference ?? null,
    });
    return {
      id: movement.id,
      shiftId: movement.shiftId,
      type: movement.type,
      amount: movement.amount,
      reason: movement.reason,
      reference: movement.reference,
      createdAt: movement.createdAt.toISOString(),
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.repo.findBranch(companyId, branchId);
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function toShiftResponse(s: RawShift): ShiftResponse {
  return {
    id: s.id,
    userId: s.userId,
    user: s.user ? { id: s.user.id, name: s.user.name } : null,
    branchId: s.branchId,
    branch: s.branch ? { id: s.branch.id, name: s.branch.name } : null,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    openingCash: s.openingCash,
    closingCash: s.closingCash,
    expectedCash: s.expectedCash,
    cashDifference: s.cashDifference,
    totalSales: s.totalSales,
    totalTransactions: s.totalTransactions,
    notes: s.notes,
    isOpen: s.isOpen,
  };
}

function toShiftDetailResponse(s: RawShiftDetail): ShiftDetailResponse {
  return {
    ...toShiftResponse(s),
    cashMovements: s.cashMovements.map((m) => ({
      id: m.id,
      shiftId: m.shiftId,
      type: m.type,
      amount: m.amount,
      reason: m.reason,
      reference: m.reference,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
