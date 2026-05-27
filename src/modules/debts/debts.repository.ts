import { Injectable } from "@nestjs/common";
import { Prisma, DebtType, DebtStatus } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const DEBT_SELECT = {
  id: true,
  type: true,
  referenceType: true,
  referenceId: true,
  partyType: true,
  partyId: true,
  partyName: true,
  description: true,
  totalAmount: true,
  paidAmount: true,
  remainingAmount: true,
  status: true,
  dueDate: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  downPayment: true,
  installmentCount: true,
  installmentInterval: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DebtSelect;

export const DEBT_DETAIL_SELECT = {
  ...DEBT_SELECT,
  payments: {
    select: {
      id: true,
      debtId: true,
      amount: true,
      method: true,
      notes: true,
      paidBy: true,
      paidAt: true,
    },
    orderBy: { paidAt: "desc" },
  },
  installments: {
    select: {
      id: true,
      debtId: true,
      installmentNo: true,
      amount: true,
      dueDate: true,
      paidAmount: true,
      paidAt: true,
      status: true,
      notes: true,
    },
    orderBy: { installmentNo: "asc" },
  },
} satisfies Prisma.DebtSelect;

export type RawDebt = Prisma.DebtGetPayload<{ select: typeof DEBT_SELECT }>;
export type RawDebtDetail = Prisma.DebtGetPayload<{
  select: typeof DEBT_DETAIL_SELECT;
}>;

@Injectable()
export class DebtsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.DebtWhereInput,
    skip: number,
    take: number,
  ): Promise<RawDebt[]> {
    return this.prisma.debt.findMany({
      where,
      select: DEBT_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.DebtWhereInput): Promise<number> {
    return this.prisma.debt.count({ where });
  }

  async findDetail(
    where: Prisma.DebtWhereInput,
  ): Promise<RawDebtDetail | null> {
    return this.prisma.debt.findFirst({
      where,
      select: DEBT_DETAIL_SELECT,
    });
  }

  async findForPayValidation(
    where: Prisma.DebtWhereInput,
  ): Promise<{
    id: string;
    totalAmount: number;
    paidAmount: number;
    status: string;
  } | null> {
    return this.prisma.debt.findFirst({
      where,
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
      },
    });
  }

  async findForDelete(
    where: Prisma.DebtWhereInput,
  ): Promise<{ id: string; paidAmount: number } | null> {
    return this.prisma.debt.findFirst({
      where,
      select: { id: true, paidAmount: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.debt.delete({ where: { id } });
  }

  async aggregateByType(
    where: Prisma.DebtWhereInput,
    type: DebtType,
  ): Promise<{
    _sum: { totalAmount: number | null; remainingAmount: number | null };
    _count: { _all: number };
  }> {
    return this.prisma.debt.aggregate({
      where: { ...where, type },
      _sum: { totalAmount: true, remainingAmount: true },
      _count: { _all: true },
    });
  }

  async aggregateOverdue(
    where: Prisma.DebtWhereInput,
    now: Date,
  ): Promise<{
    _sum: { remainingAmount: number | null };
    _count: { _all: number };
  }> {
    return this.prisma.debt.aggregate({
      where: {
        ...where,
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] as DebtStatus[] },
        dueDate: { lt: now },
      },
      _sum: { remainingAmount: true },
      _count: { _all: true },
    });
  }

  async countByStatus(
    where: Prisma.DebtWhereInput,
    status?: DebtStatus,
  ): Promise<number> {
    return this.prisma.debt.count({
      where: status ? { ...where, status } : where,
    });
  }
}
