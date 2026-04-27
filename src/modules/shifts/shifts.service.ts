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
  ShiftDetailResponse,
  ShiftListResponse,
  ShiftResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const SHIFT_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true, companyId: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  openedAt: true,
  closedAt: true,
  openingCash: true,
  closingCash: true,
  expectedCash: true,
  cashDifference: true,
  totalSales: true,
  totalTransactions: true,
  notes: true,
  isOpen: true,
} satisfies Prisma.CashierShiftSelect;

const SHIFT_DETAIL_SELECT = {
  ...SHIFT_SELECT,
  cashMovements: {
    select: {
      id: true,
      shiftId: true,
      type: true,
      amount: true,
      reason: true,
      reference: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.CashierShiftSelect;

type RawShift = Prisma.CashierShiftGetPayload<{ select: typeof SHIFT_SELECT }>;
type RawShiftDetail = Prisma.CashierShiftGetPayload<{
  select: typeof SHIFT_DETAIL_SELECT;
}>;

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListShiftsQueryDto,
  ): Promise<ShiftListResponse> {
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

    // OrderBy dinamis dengan whitelist + default fallback openedAt desc.
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
      this.prisma.cashierShift.findMany({
        where,
        select: SHIFT_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.cashierShift.count({ where }),
    ]);

    return {
      shifts: rows.map(toShiftResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ShiftDetailResponse> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id, user: { companyId } },
      select: SHIFT_DETAIL_SELECT,
    });
    if (!shift) throw new NotFoundException("Shift not found");
    return toShiftDetailResponse(shift);
  }

  async getCurrent(
    companyId: string,
    userId: string,
  ): Promise<ShiftDetailResponse | null> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { userId, isOpen: true, user: { companyId } },
      select: SHIFT_DETAIL_SELECT,
      orderBy: { openedAt: "desc" },
    });
    return shift ? toShiftDetailResponse(shift) : null;
  }

  async open(
    companyId: string,
    userId: string,
    dto: OpenShiftDto,
  ): Promise<ShiftResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const existing = await this.prisma.cashierShift.findFirst({
      where: { userId, isOpen: true },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "Shift sudah terbuka, tutup terlebih dahulu sebelum membuka shift baru",
      );
    }

    const created = await this.prisma.cashierShift.create({
      data: {
        userId,
        branchId: dto.branchId ?? null,
        openingCash: dto.openingCash,
        notes: dto.notes ?? null,
      },
      select: SHIFT_SELECT,
    });
    return toShiftResponse(created);
  }

  async close(
    companyId: string,
    userId: string,
    id: string,
    dto: CloseShiftDto,
  ): Promise<ShiftResponse> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id, user: { companyId } },
      select: {
        id: true,
        userId: true,
        branchId: true,
        openingCash: true,
        openedAt: true,
        isOpen: true,
      },
    });
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
      this.prisma.transaction.aggregate({
        where: txWhere,
        _sum: { grandTotal: true },
      }),
      this.prisma.transaction.count({
        where: {
          userId: shift.userId,
          status: "COMPLETED",
          createdAt: { gte: shift.openedAt, lte: closedAt },
          ...(shift.branchId ? { branchId: shift.branchId } : {}),
        },
      }),
      this.prisma.cashMovement.findMany({
        where: { shiftId: id },
        select: { type: true, amount: true },
      }),
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

    const updated = await this.prisma.cashierShift.update({
      where: { id },
      data: {
        closedAt,
        closingCash: dto.closingCash,
        expectedCash,
        cashDifference,
        totalSales: cashSales,
        totalTransactions: txCount,
        notes: dto.notes ?? undefined,
        isOpen: false,
      },
      select: SHIFT_SELECT,
    });
    return toShiftResponse(updated);
  }

  async addMovement(
    companyId: string,
    userId: string,
    shiftId: string,
    dto: CashMovementDto,
  ): Promise<CashMovementResponse> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: shiftId, user: { companyId } },
      select: { id: true, userId: true, isOpen: true },
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

    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId,
        type: dto.type,
        amount: dto.amount,
        reason: dto.reason,
        reference: dto.reference ?? null,
      },
      select: {
        id: true,
        shiftId: true,
        type: true,
        amount: true,
        reason: true,
        reference: true,
        createdAt: true,
      },
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
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
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
