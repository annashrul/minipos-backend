import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  APP_TIME_ZONE,
  addDaysInTimeZone,
  addMonthsInTimeZone,
  addYearsInTimeZone,
  getHourInTimeZone,
  getWeekdayInTimeZone,
  startOfDateStringInTimeZone,
  startOfDayInTimeZone,
  startOfMonthInTimeZone,
  startOfYearInTimeZone,
} from "@/common/utils/timezone";
import type {
  DashboardAlertsResponse,
  DashboardExtendedStatsQueryDto,
  DashboardExtendedStatsResponse,
  DashboardListQueryDto,
  DashboardStatsQueryDto,
  DashboardStatsResponse,
  DashboardTopProduct,
  DashboardTopCustomer,
  ExpiringListResponse,
  ExpiringProductResponse,
  LowStockBranchEntry,
  LowStockListResponse,
  LowStockProductResponse,
} from "./dto/dashboard.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { DashboardRepository } from "./dashboard.repository";

type RangeBounds = { from: Date; to: Date };

@Injectable()
export class DashboardService {
  private readonly timeZone = APP_TIME_ZONE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DashboardRepository,
  ) {}

  async stats(
    companyId: string,
    query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResponse> {
    const { branchId, period } = query;
    const range = this.resolveRange(period);
    const prevRange = this.resolvePrevRange(period, range);

    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
      status: "COMPLETED",
      createdAt: { gte: range.from, lte: range.to },
    };
    if (branchId) where.branchId = branchId;

    const prevWhere: Prisma.TransactionWhereInput = {
      user: { companyId },
      status: "COMPLETED",
      createdAt: { gte: prevRange.from, lte: prevRange.to },
    };
    if (branchId) prevWhere.branchId = branchId;

    const [currentAgg, prevAgg, itemRows, customerRows, paymentRows] =
      await Promise.all([
        this.prisma.transaction.aggregate({
          where,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.aggregate({
          where: prevWhere,
          _sum: { grandTotal: true },
        }),
        this.prisma.transactionItem.groupBy({
          by: ["productId", "productName", "productCode"],
          where: { transaction: where },
          _sum: { quantity: true, subtotal: true },
          orderBy: { _sum: { subtotal: "desc" } },
          take: 10,
        }),
        this.prisma.transaction.groupBy({
          by: ["customerId"],
          where: {
            ...where,
            customerId: { not: null },
          },
          _sum: { grandTotal: true },
          _count: { _all: true },
          orderBy: { _sum: { grandTotal: "desc" } },
          take: 5,
        }),
        this.prisma.transaction.groupBy({
          by: ["paymentMethod"],
          where,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
      ]);

    const totalSales = currentAgg._sum.grandTotal ?? 0;
    const txCount = currentAgg._count._all;
    const avg = txCount > 0 ? totalSales / txCount : 0;
    const prevTotal = prevAgg._sum.grandTotal ?? 0;
    const change = totalSales - prevTotal;
    const changePercent = prevTotal > 0 ? (change / prevTotal) * 100 : 0;

    const topProducts: DashboardTopProduct[] = itemRows.map((r) => ({
      productId: r.productId,
      name: r.productName,
      code: r.productCode,
      qty: r._sum.quantity ?? 0,
      revenue: r._sum.subtotal ?? 0,
    }));

    const customerIds = customerRows
      .map((c) => c.customerId)
      .filter((id): id is string => Boolean(id));
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [];
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));
    const topCustomers: DashboardTopCustomer[] = customerRows.map((c) => ({
      customerId: c.customerId ?? "",
      name: c.customerId ? (customerMap.get(c.customerId) ?? "") : "",
      totalSpending: c._sum.grandTotal ?? 0,
      transactionCount: c._count._all,
    }));

    const paymentBreakdown = paymentRows
      .map((p) => ({
        method: p.paymentMethod,
        count: p._count._all,
        amount: p._sum.grandTotal ?? 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    let hourlyTrend: DashboardStatsResponse["hourlyTrend"] = [];
    if (period === "today") {
      hourlyTrend = await this.computeHourlyTrend(where, range);
    }

    return {
      period,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      sales: {
        total: totalSales,
        count: txCount,
        avg,
        comparePrev: {
          total: prevTotal,
          change,
          changePercent,
        },
      },
      topProducts,
      topCustomers,
      paymentBreakdown,
      hourlyTrend,
    };
  }

  async lowStock(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<LowStockListResponse> {
    const { branchId, limit } = query;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
    };

    const candidates = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        minStock: true,
        unit: true,
        categoryId: true,
        category: { select: { name: true } },
        branchStocks: branchId
          ? {
              where: { branchId },
              select: {
                quantity: true,
                minStock: true,
                branchId: true,
                branch: { select: { id: true, name: true } },
              },
            }
          : {
              select: {
                quantity: true,
                minStock: true,
                branchId: true,
                branch: { select: { id: true, name: true } },
              },
              orderBy: { quantity: "asc" },
              take: 5,
            },
      },
      orderBy: { stock: "asc" },
      take: 500,
    });

    const filtered = candidates.filter((p) => p.stock <= p.minStock);
    const items: LowStockProductResponse[] = filtered
      .slice(0, limit)
      .map((p) => {
        const branchStocks: LowStockBranchEntry[] = p.branchStocks.map(
          (bs) => ({
            branchId: bs.branchId,
            branchName: bs.branch?.name ?? "",
            quantity: bs.quantity,
            minStock: bs.minStock,
          }),
        );
        return {
          productId: p.id,
          code: p.code,
          name: p.name,
          stock: p.stock,
          minStock: p.minStock,
          unit: p.unit,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          branchStocks,
        };
      });

    return { items, total: filtered.length };
  }

  async expiring(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<ExpiringListResponse> {
    const { limit } = query;
    const now = new Date();
    const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const products = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        expiryDate: { gt: now, lte: cutoff },
      },
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        unit: true,
        expiryDate: true,
        categoryId: true,
        category: { select: { name: true } },
      },
      orderBy: { expiryDate: "asc" },
      take: limit,
    });

    const total = await this.prisma.product.count({
      where: {
        companyId,
        isActive: true,
        expiryDate: { gt: now, lte: cutoff },
      },
    });

    const items: ExpiringProductResponse[] = products.map((p) => {
      const expiry = p.expiryDate as Date;
      const daysToExpiry = Math.ceil(
        (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        stock: p.stock,
        unit: p.unit,
        expiryDate: expiry.toISOString(),
        daysToExpiry,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
      };
    });

    return { items, total };
  }

  async alerts(companyId: string): Promise<DashboardAlertsResponse> {
    const now = new Date();
    const expiryCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [expiringCount, overdueDebtCount, candidates] = await Promise.all([
      this.prisma.product.count({
        where: {
          companyId,
          isActive: true,
          expiryDate: { gt: now, lte: expiryCutoff },
        },
      }),
      this.prisma.debt.count({
        where: {
          companyId,
          type: "RECEIVABLE",
          status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.product.findMany({
        where: { companyId, isActive: true },
        select: { stock: true, minStock: true },
      }),
    ]);
    const pendingApprovalCount = 0;

    const lowStockCount = candidates.filter(
      (p: { stock: number; minStock: number }) => p.stock <= p.minStock,
    ).length;

    return {
      lowStockCount,
      expiringCount,
      overdueDebtCount,
      pendingApprovalCount,
    };
  }

  async extendedStats(
    companyId: string,
    query: DashboardExtendedStatsQueryDto,
  ): Promise<DashboardExtendedStatsResponse> {
    const { branchId, period, from, to } = query;

    const companyBranches = await this.prisma.branch.findMany({
      where: { companyId },
      select: { id: true },
    });
    const companyBranchIds = companyBranches.map((b) => b.id);
    const branchFilter: Prisma.TransactionWhereInput = branchId
      ? { branchId }
      : { branchId: { in: companyBranchIds } };

    const now = new Date();
    const today = startOfDayInTimeZone(now, this.timeZone);
    const todayEnd = addDaysInTimeZone(today, 1, this.timeZone);

    let periodStart: Date;
    let periodEnd: Date;
    let prevPeriodStart: Date;

    if (period === "today") {
      periodStart = today;
      periodEnd = todayEnd;
      prevPeriodStart = addDaysInTimeZone(today, -1, this.timeZone);
    } else if (period === "week") {
      periodStart = addDaysInTimeZone(today, -7, this.timeZone);
      periodEnd = todayEnd;
      prevPeriodStart = addDaysInTimeZone(periodStart, -7, this.timeZone);
    } else if (period === "year") {
      periodStart = startOfYearInTimeZone(now, this.timeZone);
      periodEnd = todayEnd;
      prevPeriodStart = addYearsInTimeZone(periodStart, -1, this.timeZone);
    } else if (period === "custom" && from && to) {
      const fromStart = startOfDateStringInTimeZone(from, this.timeZone);
      const toStart = startOfDateStringInTimeZone(to, this.timeZone);
      periodStart = fromStart <= toStart ? fromStart : toStart;
      const endStart = fromStart <= toStart ? toStart : fromStart;
      periodEnd = addDaysInTimeZone(endStart, 1, this.timeZone);
      const rangeMs = Math.max(
        24 * 60 * 60 * 1000,
        periodEnd.getTime() - periodStart.getTime(),
      );
      prevPeriodStart = new Date(periodStart.getTime() - rangeMs);
    } else {
      periodStart = startOfMonthInTimeZone(now, this.timeZone);
      periodEnd = todayEnd;
      prevPeriodStart = addMonthsInTimeZone(periodStart, -1, this.timeZone);
    }

    const yesterday = addDaysInTimeZone(today, -1, this.timeZone);

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
        where: {
          createdAt: { gte: periodStart, lt: periodEnd },
          ...completedWhere,
        },
      }),
      this.prisma.transaction.count({
        where: {
          createdAt: { gte: periodStart, lt: periodEnd },
          ...completedWhere,
        },
      }),
      this.prisma.transaction.aggregate({
        _sum: { grandTotal: true },
        where: {
          createdAt: { gte: yesterday, lt: today },
          ...completedWhere,
        },
      }),
      this.prisma.transaction.count({
        where: {
          createdAt: { gte: yesterday, lt: today },
          ...completedWhere,
        },
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
        where: { isActive: true, companyId },
      }),
      this.prisma.customer.count({ where: { companyId } }),
    ]);

    const [
      recentTransactions,
      topProductsRaw,
      paymentBreakdownRaw,
      paymentBreakdownTodayRaw,
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
        take: 7,
      }),
      this.prisma.transactionItem.groupBy({
        by: ["productName"],
        _sum: { quantity: true, subtotal: true },
        where: branchId
          ? { transaction: { branchId } }
          : { transaction: { branchId: { in: companyBranchIds } } },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
      this.prisma.transaction.groupBy({
        by: ["paymentMethod"],
        _sum: { grandTotal: true },
        _count: { _all: true },
        where: {
          createdAt: { gte: periodStart, lt: periodEnd },
          ...completedWhere,
        },
      }),
      this.prisma.transaction.groupBy({
        by: ["paymentMethod"],
        _sum: { grandTotal: true },
        _count: { _all: true },
        where: {
          createdAt: { gte: today, lt: todayEnd },
          ...completedWhere,
        },
      }),
      this.getDailySalesData(30, branchId, companyBranchIds),
      this.getYearlyComparison(branchId, companyBranchIds),
      this.repo.findTopCashiers(periodStart, periodEnd, branchId, companyBranchIds),
      this.repo.findCategoryBreakdown(periodStart, periodEnd, branchId, companyBranchIds),
      this.getHourlySalesData(
        periodStart,
        periodEnd,
        branchId,
        companyBranchIds,
      ),
    ]);

    const [refundCount, voidCount, activePromotions, pendingPurchaseOrders] =
      await Promise.all([
        this.prisma.transaction.count({
          where: {
            createdAt: { gte: periodStart, lt: periodEnd },
            status: "REFUNDED",
            ...branchFilter,
          },
        }),
        this.prisma.transaction.count({
          where: {
            createdAt: { gte: periodStart, lt: periodEnd },
            status: "VOIDED",
            ...branchFilter,
          },
        }),
        this.prisma.promotion.count({
          where: {
            isActive: true,
            startDate: { lte: now },
            endDate: { gte: now },
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

    const profitRows = await this.repo.findProfit(
      periodStart,
      periodEnd,
      branchId,
      companyBranchIds,
    );

    // Low stock products (legacy shape)
    const lowStockCandidates = await this.prisma.product.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        stock: true,
        minStock: true,
        category: { select: { name: true } },
      },
      orderBy: { stock: "asc" },
      take: 200,
    });
    const lowStockProducts = lowStockCandidates
      .filter((p) => p.stock <= p.minStock)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
        category: { name: p.category?.name || "Uncategorized" },
      }));

    // Branch performance
    let branchPerformance: DashboardExtendedStatsResponse["branchPerformance"] =
      [];
    if (!branchId) {
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
            createdAt: { gte: periodStart, lt: periodEnd },
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

      branchPerformance = activeBranches.map((b) => {
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

    // Upcoming debts
    const upcomingDebtsRows = await this.prisma.debt.findMany({
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
      take: 5,
    });

    // Derived numbers
    const todaySalesVal = todayAgg._sum.grandTotal ?? 0;
    const todayTxCountVal = todayCount;
    const yesterdaySalesVal = yesterdayAgg._sum.grandTotal ?? 0;
    const yesterdayTxCountVal = yesterdayCount;
    const monthRevenueVal = todaySalesVal;
    const prevMonthRevenueVal = prevAgg._sum.grandTotal ?? 0;
    const monthTxCount = todayTxCountVal;
    const prevMonthTxCount = prevCount;

    const salesGrowthDay =
      yesterdaySalesVal > 0
        ? Math.round(
            ((todaySalesVal - yesterdaySalesVal) / yesterdaySalesVal) * 100,
          )
        : 0;
    const salesGrowthMonth =
      prevMonthRevenueVal > 0
        ? Math.round(
            ((monthRevenueVal - prevMonthRevenueVal) / prevMonthRevenueVal) *
              100,
          )
        : 0;
    const txGrowthMonth =
      prevMonthTxCount > 0
        ? Math.round(
            ((monthTxCount - prevMonthTxCount) / prevMonthTxCount) * 100,
          )
        : 0;

    const avgTransactionValue =
      todayTxCountVal > 0 ? Math.round(todaySalesVal / todayTxCountVal) : 0;
    const todayProfit = profitRows[0]?.profit ?? 0;
    const weekSales = todaySalesVal;

    const paymentBreakdown = paymentBreakdownRaw.map((p) => ({
      method: p.paymentMethod,
      total: p._sum.grandTotal || 0,
      count: p._count._all,
    }));
    const paymentBreakdownToday = paymentBreakdownTodayRaw.map((p) => ({
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
      yesterdayTransactionCount: yesterdayTxCountVal,
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
        invoiceDisplayNumber: t.invoiceDisplayNumber ?? null,
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
      paymentBreakdownToday,
      topCashiers,
      categoryBreakdown,
      hourlySales,
      avgTransactionValue,
      todayProfit,
      weekSales,
      refundCount,
      voidCount,
      activePromotions,
      pendingPurchaseOrders,
      branchPerformance,
      upcomingDebts: upcomingDebtsRows.map((d) => ({
        id: d.id,
        type: d.type as "PAYABLE" | "RECEIVABLE",
        partyName: d.partyName,
        totalAmount: d.totalAmount,
        remainingAmount: d.remainingAmount,
        status: d.status,
        dueDate: d.dueDate ? d.dueDate.toISOString() : null,
      })),
    };
  }

  private async getDailySalesData(
    days: number,
    branchId: string | undefined,
    companyBranchIds: string[],
  ) {
    const now = new Date();
    // Tengah malam HARI INI di zona bisnis, lalu mundur (days-1) hari.
    const todayStart = startOfDayInTimeZone(now, this.timeZone);
    const startDate = addDaysInTimeZone(todayStart, -(days - 1), this.timeZone);

    const rows = await this.repo.findDailySales(
      startDate,
      branchId,
      companyBranchIds,
      this.timeZone,
    );

    // row.d sudah string "YYYY-MM-DD" zona bisnis → langsung jadi key.
    const salesMap = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      salesMap.set(row.d, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    // Key & label dihitung di zona bisnis yang SAMA dgn SQL (anti off-by-one).
    const keyFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const labelFmt = new Intl.DateTimeFormat("id-ID", {
      timeZone: this.timeZone,
      day: "numeric",
      month: "short",
    });

    const result: { date: string; total: number; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayInstant = addDaysInTimeZone(todayStart, -i, this.timeZone);
      const dateKey = keyFmt.format(dayInstant);
      const data = salesMap.get(dateKey) || { total: 0, count: 0 };
      result.push({
        date: labelFmt.format(dayInstant),
        total: data.total,
        count: data.count,
      });
    }
    return result;
  }

  private async getYearlyComparison(
    branchId: string | undefined,
    companyBranchIds: string[],
  ) {
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];

    const startDate = new Date(lastYear, 0, 1);
    const rows = await this.repo.findYearlyComparison(startDate, branchId, companyBranchIds);

    const dataMap = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      dataMap.set(`${row.y}-${row.m}`, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    return monthNames.map((month, i) => {
      const thisData = dataMap.get(`${thisYear}-${i + 1}`) || {
        total: 0,
        count: 0,
      };
      const lastData = dataMap.get(`${lastYear}-${i + 1}`) || {
        total: 0,
        count: 0,
      };
      return {
        month,
        thisYear: thisData.total,
        lastYear: lastData.total,
        thisYearCount: thisData.count,
        lastYearCount: lastData.count,
      };
    });
  }

  private async getHourlySalesData(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ) {
    const rows = await this.repo.findHourlySales(
      start,
      end,
      branchId,
      companyBranchIds,
      this.timeZone,
    );

    const hoursMap = new Map<number, { total: number; count: number }>();
    for (const row of rows) {
      hoursMap.set(row.h, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    return Array.from({ length: 24 }, (_, i) => {
      const data = hoursMap.get(i) || { total: 0, count: 0 };
      return {
        hour: `${String(i).padStart(2, "0")}:00`,
        total: data.total,
        count: data.count,
      };
    });
  }

  private async computeHourlyTrend(
    where: Prisma.TransactionWhereInput,
    range: RangeBounds,
  ): Promise<DashboardStatsResponse["hourlyTrend"]> {
    const transactions = await this.prisma.transaction.findMany({
      where,
      select: { createdAt: true, grandTotal: true },
    });

    const buckets = new Map<number, { sales: number; count: number }>();
    for (let i = 0; i < 24; i++) buckets.set(i, { sales: 0, count: 0 });

    for (const t of transactions) {
      const hour = getHourInTimeZone(t.createdAt, this.timeZone);
      const bucket = buckets.get(hour);
      if (bucket) {
        bucket.sales += t.grandTotal;
        bucket.count += 1;
      }
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, v]) => ({ hour, sales: v.sales, count: v.count }));
  }

  private resolveRange(period: DashboardStatsQueryDto["period"]): RangeBounds {
    const now = new Date();
    const todayStart = startOfDayInTimeZone(now, this.timeZone);
    let start = todayStart;
    let end = new Date(
      addDaysInTimeZone(todayStart, 1, this.timeZone).getTime() - 1,
    );

    switch (period) {
      case "today":
        break;
      case "yesterday":
        start = addDaysInTimeZone(todayStart, -1, this.timeZone);
        end = new Date(todayStart.getTime() - 1);
        break;
      case "week": {
        const day = getWeekdayInTimeZone(now, this.timeZone);
        const diff = (day + 6) % 7; // Monday-based
        start = addDaysInTimeZone(todayStart, -diff, this.timeZone);
        break;
      }
      case "month":
        start = startOfMonthInTimeZone(now, this.timeZone);
        break;
      case "year":
        start = startOfYearInTimeZone(now, this.timeZone);
        break;
    }

    return { from: start, to: end };
  }

  private resolvePrevRange(
    period: DashboardStatsQueryDto["period"],
    range: RangeBounds,
  ): RangeBounds {
    const from = new Date(range.from);
    const to = new Date(range.to);

    switch (period) {
      case "today":
      case "yesterday": {
        from.setDate(from.getDate() - 1);
        to.setDate(to.getDate() - 1);
        return { from, to };
      }
      case "week": {
        from.setDate(from.getDate() - 7);
        to.setDate(to.getDate() - 7);
        return { from, to };
      }
      case "month": {
        from.setMonth(from.getMonth() - 1);
        to.setMonth(to.getMonth() - 1);
        return { from, to };
      }
      case "year": {
        from.setFullYear(from.getFullYear() - 1);
        to.setFullYear(to.getFullYear() - 1);
        return { from, to };
      }
    }
  }
}
