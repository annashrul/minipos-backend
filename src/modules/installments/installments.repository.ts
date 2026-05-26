import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const DEBT_DETAIL_SELECT = {
  id: true,
  totalAmount: true,
  paidAmount: true,
  remainingAmount: true,
  status: true,
  downPayment: true,
  installmentCount: true,
  installmentInterval: true,
  partyName: true,
  description: true,
  dueDate: true,
  installments: { orderBy: { installmentNo: "asc" as const } },
  payments: {
    orderBy: { paidAt: "desc" as const },
    select: {
      id: true,
      amount: true,
      method: true,
      notes: true,
      paidAt: true,
    },
  },
} satisfies Prisma.DebtSelect;

export type RawDebtDetail = Prisma.DebtGetPayload<{
  select: typeof DEBT_DETAIL_SELECT;
}>;

export const INSTALLMENT_WITH_DEBT_SELECT = {
  id: true,
  debtId: true,
  installmentNo: true,
  amount: true,
  dueDate: true,
  paidAmount: true,
  paidAt: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  debt: {
    select: {
      partyName: true,
      description: true,
      type: true,
      referenceType: true,
      referenceId: true,
    },
  },
} satisfies Prisma.InstallmentSelect;

export type RawUpcomingInstallment = Prisma.InstallmentGetPayload<{
  select: typeof INSTALLMENT_WITH_DEBT_SELECT;
}>;

export const INSTALLMENT_PAY_SELECT = {
  id: true,
  debtId: true,
  installmentNo: true,
  amount: true,
  paidAmount: true,
  status: true,
  debt: {
    select: {
      id: true,
      companyId: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
    },
  },
} satisfies Prisma.InstallmentSelect;

export type RawInstallmentForPay = Prisma.InstallmentGetPayload<{
  select: typeof INSTALLMENT_PAY_SELECT;
}>;

@Injectable()
export class InstallmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDebt(
    id: string,
    companyId: string,
  ): Promise<Prisma.DebtGetPayload<{
    select: {
      id: true;
      totalAmount: true;
      paidAmount: true;
      remainingAmount: true;
      status: true;
    };
  }> | null> {
    return this.prisma.debt.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        status: true,
      },
    });
  }

  async findDebtWithInstallments(
    debtId: string,
    companyId: string,
  ): Promise<RawDebtDetail | null> {
    return this.prisma.debt.findFirst({
      where: { id: debtId, companyId },
      select: DEBT_DETAIL_SELECT,
    });
  }

  async findInstallmentForPay(
    installmentId: string,
  ): Promise<RawInstallmentForPay | null> {
    return this.prisma.installment.findUnique({
      where: { id: installmentId },
      select: INSTALLMENT_PAY_SELECT,
    });
  }

  async findUpcoming(
    companyId: string,
    futureDate: Date,
  ): Promise<RawUpcomingInstallment[]> {
    return this.prisma.installment.findMany({
      where: {
        status: { in: ["UNPAID", "PARTIAL"] },
        dueDate: { lte: futureDate },
        debt: { companyId },
      },
      select: INSTALLMENT_WITH_DEBT_SELECT,
      orderBy: { dueDate: "asc" },
      take: 50,
    });
  }

  async updateOverdue(companyId: string, now: Date): Promise<number> {
    const result = await this.prisma.installment.updateMany({
      where: {
        status: "UNPAID",
        dueDate: { lt: now },
        debt: { companyId },
      },
      data: { status: "OVERDUE" },
    });
    return result.count;
  }
}
