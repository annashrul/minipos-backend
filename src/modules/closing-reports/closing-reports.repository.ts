import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const CLOSING_REPORT_SELECT = {
  id: true,
  shiftId: true,
  cashierUserId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  companyId: true,
  cashierName: true,
  date: true,
  openingCash: true,
  closingCash: true,
  expectedCash: true,
  cashDifference: true,
  totalTransactions: true,
  totalSales: true,
  totalDiscount: true,
  totalTax: true,
  totalCashSales: true,
  totalNonCashSales: true,
  cashMovementIn: true,
  cashMovementOut: true,
  voidCount: true,
  refundCount: true,
  paymentSummary: true,
  notes: true,
  allowReopen: true,
  createdAt: true,
  shift: {
    select: {
      id: true,
      openedAt: true,
      closedAt: true,
    },
  },
} satisfies Prisma.ClosingReportSelect;

export type RawClosingReport = Prisma.ClosingReportGetPayload<{
  select: typeof CLOSING_REPORT_SELECT;
}>;

@Injectable()
export class ClosingReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.ClosingReportWhereInput,
    skip: number,
    take: number,
  ): Promise<RawClosingReport[]> {
    return this.prisma.closingReport.findMany({
      where,
      select: CLOSING_REPORT_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.ClosingReportWhereInput): Promise<number> {
    return this.prisma.closingReport.count({ where });
  }

  async findOne(
    where: Prisma.ClosingReportWhereInput,
  ): Promise<RawClosingReport | null> {
    return this.prisma.closingReport.findFirst({
      where,
      select: CLOSING_REPORT_SELECT,
    });
  }

  async findById(
    where: Prisma.ClosingReportWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.closingReport.findFirst({
      where,
      select: { id: true },
    });
  }

  async findByShiftId(
    shiftId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.closingReport.findUnique({
      where: { shiftId },
      select: { id: true },
    });
  }

  async findShift(where: Prisma.CashierShiftWhereInput) {
    return this.prisma.cashierShift.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        branchId: true,
        openedAt: true,
        closedAt: true,
        openingCash: true,
        closingCash: true,
        expectedCash: true,
        cashDifference: true,
        isOpen: true,
        user: { select: { id: true, name: true, companyId: true } },
      },
    });
  }

  async findShiftForReclose(where: Prisma.CashierShiftWhereInput) {
    return this.prisma.cashierShift.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        branchId: true,
        openedAt: true,
        closedAt: true,
        openingCash: true,
        isOpen: true,
        user: { select: { id: true, name: true } },
      },
    });
  }

  async aggregateTransactions(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: {
        grandTotal: true,
        discountAmount: true,
        taxAmount: true,
      },
      _count: { _all: true },
    });
  }

  async aggregateTransactionsSum(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: { grandTotal: true },
    });
  }

  async aggregateTransactionsCount(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      where,
      _count: { _all: true },
    });
  }

  async groupCashMovements(shiftId: string) {
    return this.prisma.cashMovement.groupBy({
      by: ["type"],
      where: { shiftId },
      _sum: { amount: true },
    });
  }

  async groupPaymentMethods(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.groupBy({
      by: ["paymentMethod"],
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
  }

  async update(
    id: string,
    data: Prisma.ClosingReportUpdateInput,
  ): Promise<RawClosingReport> {
    return this.prisma.closingReport.update({
      where: { id },
      data,
      select: CLOSING_REPORT_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.closingReport.delete({ where: { id } });
  }
}
