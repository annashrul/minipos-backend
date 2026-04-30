import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  DashboardExtendedStatsQueryDto,
  DashboardExtendedStatsResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { DashboardRawQueries } from "./dashboard-raw-queries";
import { DashboardStockService } from "./dashboard-stock.service";

const RECENT_TX_LIMIT = 7;
const TOP_PRODUCTS_LIMIT = 5;
const UPCOMING_DEBTS_LIMIT = 5;
const DAILY_SALES_DAYS = 30;

@Injectable()
export class DashboardExtendedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly raw: DashboardRawQueries,
    private readonly stock: DashboardStockService,
  ) {}

  async extendedStats(
    companyId: string,
    query: DashboardExtendedStatsQueryDto,
  ): Promise<DashboardExtendedStatsResponse> {
    const { branchId, period } = query;

    const companyBranches = await this.prisma.branch.findMany({
      where: { companyId },
      select: { id: true },
    });
    const companyBranchIds = companyBranches.map((b) => b.id);
    const branchFilter: Prisma.TransactionWhereInput = branchId
      ? { branchId }
      : { branchId: { in: companyBranchIds } };

    const periods = computePeriodBoundaries(period);
    const { periodStart, prevPeriodStart, today, tomorrow, yesterday } = periods;

    const completedWhere: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      ...branchFilter,
    };

    const [
      todayAgg,
      todayCount,
      yesterdayAgg,
      yesterdayCount,
      prevAgg,
      prevCount,
      totalProducts,
      totalCustomers,
    ] = await Promise.all([
      this.prisma.transaction.aggregate({
        _sum: { grandTotal: true },
        where: { createdAt: { gte: periodStart, lt: tomorrow }, ...completedWhere },
      }),
      this.prisma.transaction.count({
        where: { createdAt: { gte: periodStart, lt: tomorrow }, ...completedWhere },
      }),
      this.prisma.transaction.aggregate({
        _sum: { grandTotal: true },
        where: { createdAt: { gte: yesterday, lt: today }, ...completedWhere },
      }),
      this.prisma.transaction.count({
        where: { createdAt: { gte: yesterday, lt: today }, ...completedWhere },
      }),
      this.prisma.transaction.aggregate({
        _sum: { grandTotal: true },
        where: {
          createdAt: { gte: prevPeriodStart, lt: periodStart },
          ...completedWhere,
        },
      }),
      this.prisma.transaction.count({
        where: {
          createdAt: { gte: prevPeriodStart, lt: periodStart },
          ...completedWhere,
        },
      }),
      this.prisma.product.count({
        where: { isActive: true, companyId, deletedAt: null },
      }),
      this.prisma.customer.count({ where: { companyId } }),
    ]);

    const [
      recentTransactions,
      topProductsRaw,
      paymentBreakdownRaw,
      dailySales,
      yearlyComparison,
      topCashiers,
      categoryBreakdown,
      hourlySales,
    ] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { ...branchFilter },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: RECENT_TX_LIMIT,
      }),
      this.prisma.transactionItem.groupBy({
        by: ["productName"],
        _sum: { quantity: true, subtotal: true },
        where: branchId
          ? { transaction: { branchId } }
          : { transaction: { branchId: { in: companyBranchIds } } },
        orderBy: { _sum: { quantity: "desc" } },
        take: TOP_PRODUCTS_LIMIT,
      }),
      this.prisma.transaction.groupBy({
        by: ["paymentMethod"],
        _sum: { grandTotal: true },
        _count: { _all: true },
        where: { createdAt: { gte: periodStart, lt: tomorrow }, ...completedWhere },
      }),
      this.raw.dailySales(DAILY_SALES_DAYS, branchId, companyBranchIds),
      this.raw.yearlyComparison(branchId, companyBranchIds),
      this.raw.topCashiers(periodStart, tomorrow, branchId, companyBranchIds),
      this.raw.categoryBreakdown(periodStart, tomorrow, branchId, companyBranchIds),
      this.raw.hourlySales(periodStart, tomorrow, branchId, companyBranchIds),
    ]);

    const [refundCount, voidCount, activePromotions, pendingPurchaseOrders] =
      await Promise.all([
        this.prisma.transaction.count({
          where: {
            createdAt: { gte: periodStart, lt: tomorrow },
            status: "REFUNDED",
            ...branchFilter,
          },
        }),
        this.prisma.transaction.count({
          where: {
            createdAt: { gte: periodStart, lt: tomorrow },
            status: "VOIDED",
            ...branchFilter,
          },
        }),
        this.prisma.promotion.count({
          where: {
            isActive: true,
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
            companyId,
          },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            status: { in: ["DRAFT", "ORDERED"] },
            ...(branchId
              ? { branchId }
              : { branchId: { in: companyBranchIds } }),
          },
        }),
      ]);

    const todayProfit = await this.raw.periodProfit(
      periodStart,
      tomorrow,
      branchId,
      companyBranchIds,
    );

    const lowStockProducts = await this.stock.legacyLowStockShape(companyId);
    const branchPerformance = await this.computeBranchPerformance(
      branchId,
      companyBranchIds,
      companyId,
      periodStart,
      prevPeriodStart,
      tomorrow,
    );
    const upcomingDebts = await this.loadUpcomingDebts(
      branchId,
      companyId,
      companyBranchIds,
    );

    const todaySalesVal = todayAgg._sum.grandTotal ?? 0;
    const todayTxCountVal = todayCount;
    const yesterdaySalesVal = yesterdayAgg._sum.grandTotal ?? 0;
    const monthRevenueVal = todaySalesVal;
    const prevMonthRevenueVal = prevAgg._sum.grandTotal ?? 0;
    const monthTxCount = todayTxCountVal;
    const prevMonthTxCount = prevCount;

    const salesGrowthDay =
      yesterdaySalesVal > 0
        ? Math.round(((todaySalesVal - yesterdaySalesVal) / yesterdaySalesVal) * 100)
        : 0;
    const salesGrowthMonth =
      prevMonthRevenueVal > 0
        ? Math.round(((monthRevenueVal - prevMonthRevenueVal) / prevMonthRevenueVal) * 100)
        : 0;
    const txGrowthMonth =
      prevMonthTxCount > 0
        ? Math.round(((monthTxCount - prevMonthTxCount) / prevMonthTxCount) * 100)
        : 0;
    const avgTransactionValue =
      todayTxCountVal > 0 ? Math.round(todaySalesVal / todayTxCountVal) : 0;

    const paymentBreakdown = paymentBreakdownRaw.map((p) => ({
      method: p.paymentMethod,
      total: p._sum.grandTotal || 0,
      count: p._count._all,
    }));

    const topProducts = topProductsRaw.map((p) => ({
      productName: p.productName,
      _sum: {
        quantity: p._sum.quantity ?? null,
        subtotal: p._sum.subtotal ?? null,
      },
    }));

    return {
      todaySales: todaySalesVal,
      todayTransactionCount: todayTxCountVal,
      yesterdaySales: yesterdaySalesVal,
      yesterdayTransactionCount: yesterdayCount,
      monthRevenue: monthRevenueVal,
      monthTransactionCount: monthTxCount,
      prevMonthRevenue: prevMonthRevenueVal,
      prevMonthTransactionCount: prevMonthTxCount,
      totalProducts,
      totalCustomers,
      salesGrowthDay,
      salesGrowthMonth,
      txGrowthMonth,
      lowStockProducts,
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        invoiceNumber: t.invoiceNumber,
        grandTotal: t.grandTotal,
        paymentMethod: t.paymentMethod,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        user: { name: t.user?.name ?? "" },
      })),
      topProducts,
      dailySales,
      yearlyComparison,
      paymentBreakdown,
      topCashiers,
      categoryBreakdown,
      hourlySales,
      avgTransactionValue,
      todayProfit,
      weekSales: todaySalesVal,
      refundCount,
      voidCount,
      activePromotions,
      pendingPurchaseOrders,
      branchPerformance,
      upcomingDebts,
    };
  }

  private async computeBranchPerformance(
    branchId: string | undefined,
    companyBranchIds: string[],
    companyId: string,
    periodStart: Date,
    prevPeriodStart: Date,
    tomorrow: Date,
  ): Promise<DashboardExtendedStatsResponse["branchPerformance"]> {
    if (branchId) return [];

    const companyBranchFilter: Prisma.TransactionWhereInput = {
      branchId: { in: companyBranchIds },
    };
    const [activeBranches, periodByBranch, prevByBranch] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true, companyId },
        select: { id: true, name: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["branchId"],
        where: {
          createdAt: { gte: periodStart, lt: tomorrow },
          status: "COMPLETED",
          ...companyBranchFilter,
        },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["branchId"],
        where: {
          createdAt: { gte: prevPeriodStart, lt: periodStart },
          status: "COMPLETED",
          ...companyBranchFilter,
        },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
    ]);

    const periodMap = new Map(
      periodByBranch.map((r) => [
        r.branchId ?? "",
        { sales: r._sum.grandTotal ?? 0, count: r._count._all },
      ]),
    );
    const prevMap = new Map(
      prevByBranch.map((r) => [
        r.branchId ?? "",
        { sales: r._sum.grandTotal ?? 0, count: r._count._all },
      ]),
    );

    return activeBranches.map((b) => {
      const curr = periodMap.get(b.id) || { sales: 0, count: 0 };
      const prev = prevMap.get(b.id) || { sales: 0, count: 0 };
      return {
        branchId: b.id,
        branchName: b.name,
        periodSales: curr.sales,
        periodTransactions: curr.count,
        prevPeriodSales: prev.sales,
        prevPeriodTransactions: prev.count,
      };
    });
  }

  private async loadUpcomingDebts(
    branchId: string | undefined,
    companyId: string,
    companyBranchIds: string[],
  ): Promise<DashboardExtendedStatsResponse["upcomingDebts"]> {
    const rows = await this.prisma.debt.findMany({
      where: {
        status: { in: ["UNPAID", "PARTIAL"] },
        OR: [
          { companyId },
          ...(companyBranchIds.length
            ? [{ branchId: { in: companyBranchIds } }]
            : []),
        ],
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        type: true,
        partyName: true,
        totalAmount: true,
        remainingAmount: true,
        status: true,
        dueDate: true,
      },
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: UPCOMING_DEBTS_LIMIT,
    });

    return rows.map((d) => ({
      id: d.id,
      type: d.type as "PAYABLE" | "RECEIVABLE",
      partyName: d.partyName,
      totalAmount: d.totalAmount,
      remainingAmount: d.remainingAmount,
      status: d.status,
      dueDate: d.dueDate ? d.dueDate.toISOString() : null,
    }));
  }
}

function computePeriodBoundaries(
  period: DashboardExtendedStatsQueryDto["period"],
): {
  periodStart: Date;
  prevPeriodStart: Date;
  today: Date;
  tomorrow: Date;
  yesterday: Date;
} {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let periodStart: Date;
  let prevPeriodStart: Date;
  if (period === "today") {
    periodStart = today;
    prevPeriodStart = new Date(today);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - 1);
  } else if (period === "week") {
    periodStart = new Date(today);
    periodStart.setDate(today.getDate() - 7);
    prevPeriodStart = new Date(periodStart);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - 7);
  } else if (period === "year") {
    periodStart = new Date(today.getFullYear(), 0, 1);
    prevPeriodStart = new Date(today.getFullYear() - 1, 0, 1);
  } else {
    periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
    prevPeriodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  }

  return { periodStart, prevPeriodStart, today, tomorrow, yesterday };
}
