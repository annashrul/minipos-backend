import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CashierPerformanceLeaderboardQueryDto,
  CashierPerformanceListResponse,
  CashierPerformanceQueryDto,
  CashierPerformanceResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { monthRange, periodRange, round2 } from "./cashier.shared";

@Injectable()
export class CashierPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getPerformance(
    companyId: string,
    query: CashierPerformanceQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    const now = new Date();
    const defaultRange = monthRange(now);
    const from = query.from ? new Date(query.from) : defaultRange.start;
    const to = query.to ? new Date(query.to) : defaultRange.end;

    const performance = await this.computePerformance(companyId, from, to, {
      userId: query.userId,
      branchId: query.branchId,
    });

    return {
      performance,
      total: performance.length,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async getLeaderboard(
    companyId: string,
    query: CashierPerformanceLeaderboardQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    const { start, end } = periodRange(query.period, new Date());
    const performance = await this.computePerformance(companyId, start, end);
    const top = performance.slice(0, query.limit);

    return {
      performance: top,
      total: top.length,
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }

  async getMyPerformance(
    companyId: string,
    userId: string,
  ): Promise<CashierPerformanceResponse | null> {
    const { start, end } = monthRange(new Date());
    const performance = await this.computePerformance(companyId, start, end, {
      userId,
    });
    return performance[0] ?? null;
  }

  private async computePerformance(
    companyId: string,
    from: Date,
    to: Date,
    filters: { userId?: string; branchId?: string } = {},
  ): Promise<CashierPerformanceResponse[]> {
    const userWhere: Prisma.UserWhereInput = { companyId };
    if (filters.userId) userWhere.id = filters.userId;
    if (filters.branchId) userWhere.branchId = filters.branchId;

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true },
    });
    if (users.length === 0) return [];
    const userIds = users.map((u) => u.id);

    const txWhereBase: Prisma.TransactionWhereInput = {
      userId: { in: userIds },
      createdAt: { gte: from, lte: to },
    };
    if (filters.branchId) txWhereBase.branchId = filters.branchId;

    const completedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "COMPLETED",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "VOIDED",
    };

    const shiftWhere: Prisma.CashierShiftWhereInput = {
      userId: { in: userIds },
      isOpen: false,
      closedAt: { not: null, gte: from, lte: to },
      openedAt: { gte: from, lte: to },
    };
    if (filters.branchId) shiftWhere.branchId = filters.branchId;

    const [completedAgg, refundedAgg, voidedAgg, shifts] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: completedWhere,
        _sum: { grandTotal: true, discountAmount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: refundedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: voidedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.cashierShift.findMany({
        where: shiftWhere,
        select: { userId: true, openedAt: true, closedAt: true },
      }),
    ]);

    const salesMap = new Map<string, number>();
    const discountMap = new Map<string, number>();
    const txCountMap = new Map<string, number>();
    for (const row of completedAgg) {
      salesMap.set(row.userId, row._sum.grandTotal ?? 0);
      discountMap.set(row.userId, row._sum.discountAmount ?? 0);
      txCountMap.set(row.userId, row._count._all);
    }

    const refundMap = new Map<string, number>();
    for (const row of refundedAgg) {
      refundMap.set(row.userId, row._sum.grandTotal ?? 0);
    }

    const voidMap = new Map<string, number>();
    for (const row of voidedAgg) {
      voidMap.set(row.userId, row._sum.grandTotal ?? 0);
    }

    const hoursMap = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.closedAt) continue;
      const ms = shift.closedAt.getTime() - shift.openedAt.getTime();
      if (ms <= 0) continue;
      const hours = ms / (1000 * 60 * 60);
      hoursMap.set(shift.userId, (hoursMap.get(shift.userId) ?? 0) + hours);
    }

    const rows: CashierPerformanceResponse[] = users.map((user) => {
      const totalSales = salesMap.get(user.id) ?? 0;
      const totalTransactions = txCountMap.get(user.id) ?? 0;
      const hoursWorked = round2(hoursMap.get(user.id) ?? 0);
      return {
        userId: user.id,
        userName: user.name,
        totalSales,
        totalTransactions,
        avgTransaction:
          totalTransactions > 0 ? totalSales / totalTransactions : 0,
        totalDiscount: discountMap.get(user.id) ?? 0,
        totalRefund: refundMap.get(user.id) ?? 0,
        totalVoid: voidMap.get(user.id) ?? 0,
        hoursWorked,
        salesPerHour: hoursWorked > 0 ? totalSales / hoursWorked : 0,
        rankBySales: 0,
        rankByTransactions: 0,
      };
    });

    const bySales = [...rows].sort((a, b) => b.totalSales - a.totalSales);
    bySales.forEach((row, idx) => {
      row.rankBySales = idx + 1;
    });

    const byTx = [...rows].sort(
      (a, b) => b.totalTransactions - a.totalTransactions,
    );
    byTx.forEach((row, idx) => {
      row.rankByTransactions = idx + 1;
    });

    return bySales;
  }
}
