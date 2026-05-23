import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const SHIFT_SELECT = {
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

export const SHIFT_DETAIL_SELECT = {
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

export type RawShift = Prisma.CashierShiftGetPayload<{
  select: typeof SHIFT_SELECT;
}>;
export type RawShiftDetail = Prisma.CashierShiftGetPayload<{
  select: typeof SHIFT_DETAIL_SELECT;
}>;

@Injectable()
export class ShiftsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.CashierShiftWhereInput,
    orderBy: Prisma.CashierShiftOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawShift[]> {
    return this.prisma.cashierShift.findMany({
      where,
      select: SHIFT_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.CashierShiftWhereInput): Promise<number> {
    return this.prisma.cashierShift.count({ where });
  }

  async findOne(
    where: Prisma.CashierShiftWhereInput,
  ): Promise<RawShift | null> {
    return this.prisma.cashierShift.findFirst({
      where,
      select: SHIFT_SELECT,
    });
  }

  async findDetail(
    where: Prisma.CashierShiftWhereInput,
    orderBy?: Prisma.CashierShiftOrderByWithRelationInput,
  ): Promise<RawShiftDetail | null> {
    return this.prisma.cashierShift.findFirst({
      where,
      select: SHIFT_DETAIL_SELECT,
      ...(orderBy ? { orderBy } : {}),
    });
  }

  async findById(
    where: Prisma.CashierShiftWhereInput,
  ): Promise<{ id: string; userId: true; isOpen: true } | null> {
    return this.prisma.cashierShift.findFirst({
      where,
      select: { id: true, userId: true, isOpen: true },
    }) as any;
  }

  async findForClose(
    where: Prisma.CashierShiftWhereInput,
  ) {
    return this.prisma.cashierShift.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        branchId: true,
        openingCash: true,
        openedAt: true,
        isOpen: true,
      },
    });
  }

  async create(
    data: Prisma.CashierShiftUncheckedCreateInput,
  ): Promise<RawShift> {
    return this.prisma.cashierShift.create({
      data,
      select: SHIFT_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.CashierShiftUpdateInput,
  ): Promise<RawShift> {
    return this.prisma.cashierShift.update({
      where: { id },
      data,
      select: SHIFT_SELECT,
    });
  }

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async aggregateTransactions(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: { grandTotal: true },
    });
  }

  async countTransactions(where: Prisma.TransactionWhereInput): Promise<number> {
    return this.prisma.transaction.count({ where });
  }

  async findCashMovements(shiftId: string) {
    return this.prisma.cashMovement.findMany({
      where: { shiftId },
      select: { type: true, amount: true },
    });
  }

  async createCashMovement(data: Prisma.CashMovementUncheckedCreateInput) {
    return this.prisma.cashMovement.create({
      data,
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
  }
}
