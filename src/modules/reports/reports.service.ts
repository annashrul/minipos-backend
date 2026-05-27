import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AgingBucketKey,
  AgingBucketSummary,
  AgingCustomerEntry,
  AgingReportQueryDto,
  AgingReportResponse,
  CustomerReportQueryDto,
  CustomerReportResponse,
  PaymentMethodReportQueryDto,
  PaymentMethodReportResponse,
  ProductReportQueryDto,
  ProductReportResponse,
  ProfitLossReportQueryDto,
  ProfitLossReportResponse,
  SalesReportQueryDto,
  SalesReportResponse,
  SalesReportSeriesEntry,
} from "./dto/reports.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ReportsRepository } from "./reports.repository";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReportsRepository,
  ) {}

  async sales(
    companyId: string,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponse> {
    const { from, to, branchId, groupBy } = query;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const baseWhere: Prisma.TransactionWhereInput = {
      user: { companyId },
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (branchId) baseWhere.branchId = branchId;

    const transactions = await this.prisma.transaction.findMany({
      where: baseWhere,
      select: {
        id: true,
        status: true,
        grandTotal: true,
        createdAt: true,
      },
    });

    const seriesMap = new Map<string, SalesReportSeriesEntry>();
    let totalSales = 0;
    let totalTransactions = 0;
    let totalRefund = 0;
    let totalVoid = 0;

    for (const t of transactions) {
      const periodKey = this.bucketKey(t.createdAt, groupBy);
      const entry =
        seriesMap.get(periodKey) ??
        ({
          period: periodKey,
          totalSales: 0,
          totalTransactions: 0,
          totalRefund: 0,
          totalVoid: 0,
          netSales: 0,
        } satisfies SalesReportSeriesEntry);

      if (t.status === "COMPLETED") {
        entry.totalSales += t.grandTotal;
        entry.totalTransactions += 1;
        totalSales += t.grandTotal;
        totalTransactions += 1;
      } else if (t.status === "REFUNDED") {
        entry.totalRefund += t.grandTotal;
        totalRefund += t.grandTotal;
      } else if (t.status === "VOIDED") {
        entry.totalVoid += t.grandTotal;
        totalVoid += t.grandTotal;
      }
      entry.netSales = entry.totalSales - entry.totalRefund;
      seriesMap.set(periodKey, entry);
    }

    const series = Array.from(seriesMap.values()).sort((a, b) =>
      a.period.localeCompare(b.period),
    );

    const netSales = totalSales - totalRefund;
    const avgTransaction =
      totalTransactions > 0 ? totalSales / totalTransactions : 0;

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      groupBy,
      series,
      totals: {
        totalSales,
        totalTransactions,
        totalRefund,
        totalVoid,
        netSales,
        avgTransaction,
      },
    };
  }

  async products(
    companyId: string,
    query: ProductReportQueryDto,
  ): Promise<ProductReportResponse> {
    const { from, to, branchId, categoryId, limit } = query;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const txWhere: Prisma.TransactionWhereInput = {
      user: { companyId },
      status: "COMPLETED",
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (branchId) txWhere.branchId = branchId;

    const itemWhere: Prisma.TransactionItemWhereInput = {
      transaction: txWhere,
    };
    if (categoryId) {
      itemWhere.product = { categoryId };
    }

    const grouped = await this.prisma.transactionItem.groupBy({
      by: ["productId", "productName", "productCode"],
      where: itemWhere,
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { subtotal: "desc" } },
      take: limit,
    });

    const productIds = grouped.map((g) => g.productId);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, purchasePrice: true },
        })
      : [];
    const purchaseMap = new Map(
      products.map((p) => [p.id, p.purchasePrice ?? 0]),
    );

    const items = grouped.map((g) => {
      const qty = g._sum.quantity ?? 0;
      const revenue = g._sum.subtotal ?? 0;
      const cost = qty * (purchaseMap.get(g.productId) ?? 0);
      return {
        productId: g.productId,
        code: g.productCode,
        name: g.productName,
        qtySold: qty,
        revenue,
        profitMargin: revenue - cost,
      };
    });

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      items,
    };
  }

  async customers(
    companyId: string,
    query: CustomerReportQueryDto,
  ): Promise<CustomerReportResponse> {
    const { from, to, limit } = query;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const grouped = await this.prisma.transaction.groupBy({
      by: ["customerId"],
      where: {
        user: { companyId },
        status: "COMPLETED",
        createdAt: { gte: fromDate, lte: toDate },
        customerId: { not: null },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
      orderBy: { _sum: { grandTotal: "desc" } },
      take: limit,
    });

    const customerIds = grouped
      .map((g) => g.customerId)
      .filter((id): id is string => Boolean(id));
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map(customers.map((c) => [c.id, c.name]));

    const items = grouped.map((g) => {
      const total = g._sum.grandTotal ?? 0;
      const count = g._count._all;
      return {
        customerId: g.customerId ?? "",
        name: g.customerId ? nameMap.get(g.customerId) ?? "" : "",
        totalSpending: total,
        transactionCount: count,
        avgTransaction: count > 0 ? total / count : 0,
      };
    });

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      items,
    };
  }

  async paymentMethods(
    companyId: string,
    query: PaymentMethodReportQueryDto,
  ): Promise<PaymentMethodReportResponse> {
    const { from, to, branchId } = query;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
      status: "COMPLETED",
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (branchId) where.branchId = branchId;

    const grouped = await this.prisma.transaction.groupBy({
      by: ["paymentMethod"],
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });

    const total = grouped.reduce((s, g) => s + (g._sum.grandTotal ?? 0), 0);

    const items = grouped
      .map((g) => {
        const amount = g._sum.grandTotal ?? 0;
        return {
          method: g.paymentMethod,
          count: g._count._all,
          amount,
          percentage: total > 0 ? (amount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      items,
      total,
    };
  }

  async aging(
    companyId: string,
    query: AgingReportQueryDto,
  ): Promise<AgingReportResponse> {
    const { branchId, limit } = query;

    const where: Prisma.DebtWhereInput = {
      companyId,
      type: "RECEIVABLE",
      status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
    };
    if (branchId) where.branchId = branchId;

    const debts = await this.prisma.debt.findMany({
      where,
      select: {
        id: true,
        partyId: true,
        partyName: true,
        remainingAmount: true,
        dueDate: true,
      },
    });

    const now = new Date();

    const bucketTotals: Record<AgingBucketKey, { count: number; total: number }> = {
      current: { count: 0, total: 0 },
      "1-30": { count: 0, total: 0 },
      "31-60": { count: 0, total: 0 },
      "61-90": { count: 0, total: 0 },
      "90+": { count: 0, total: 0 },
    };

    type CustomerAgg = {
      partyId: string | null;
      partyName: string;
      totalRemaining: number;
      worstBucket: AgingBucketKey;
    };
    const customerMap = new Map<string, CustomerAgg>();
    const bucketOrder: AgingBucketKey[] = [
      "current",
      "1-30",
      "31-60",
      "61-90",
      "90+",
    ];

    for (const d of debts) {
      const bucket = this.computeAgingBucket(d.dueDate, now);
      bucketTotals[bucket].count += 1;
      bucketTotals[bucket].total += d.remainingAmount;

      const key = d.partyId ?? `name:${d.partyName}`;
      const entry =
        customerMap.get(key) ??
        ({
          partyId: d.partyId,
          partyName: d.partyName,
          totalRemaining: 0,
          worstBucket: "current",
        } satisfies CustomerAgg);
      entry.totalRemaining += d.remainingAmount;
      if (bucketOrder.indexOf(bucket) > bucketOrder.indexOf(entry.worstBucket)) {
        entry.worstBucket = bucket;
      }
      customerMap.set(key, entry);
    }

    const buckets: AgingBucketSummary[] = bucketOrder.map((bucket) => ({
      bucket,
      count: bucketTotals[bucket].count,
      totalRemaining: bucketTotals[bucket].total,
    }));

    const customers: AgingCustomerEntry[] = Array.from(customerMap.values())
      .sort((a, b) => b.totalRemaining - a.totalRemaining)
      .slice(0, limit);

    return { buckets, customers };
  }

  async profitLoss(
    companyId: string,
    query: ProfitLossReportQueryDto,
  ): Promise<ProfitLossReportResponse> {
    const { from, to, branchId } = query;
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const txWhere: Prisma.TransactionWhereInput = {
      user: { companyId },
      status: "COMPLETED",
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (branchId) txWhere.branchId = branchId;

    const expenseWhere: Prisma.ExpenseWhereInput = {
      OR: [{ companyId }, { branch: { companyId } }],
      date: { gte: fromDate, lte: toDate },
    };
    if (branchId) expenseWhere.branchId = branchId;

    const [salesAgg, items, expenseGrouped, expenseTotalAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: txWhere,
        _sum: { grandTotal: true },
      }),
      this.prisma.transactionItem.findMany({
        where: { transaction: txWhere },
        select: {
          quantity: true,
          productId: true,
        },
      }),
      this.prisma.expense.groupBy({
        by: ["category"],
        where: expenseWhere,
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: expenseWhere,
        _sum: { amount: true },
      }),
    ]);

    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, purchasePrice: true },
        })
      : [];
    const purchaseMap = new Map(
      products.map((p) => [p.id, p.purchasePrice ?? 0]),
    );

    let totalCost = 0;
    for (const it of items) {
      totalCost += it.quantity * (purchaseMap.get(it.productId) ?? 0);
    }

    const sales = salesAgg._sum.grandTotal ?? 0;
    const otherIncome = 0;
    const revenueTotal = sales + otherIncome;
    const grossProfit = revenueTotal - totalCost;
    const grossMargin = revenueTotal > 0 ? (grossProfit / revenueTotal) * 100 : 0;

    const expensesByCategory = expenseGrouped
      .map((e) => ({ category: e.category, amount: e._sum.amount ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
    const expensesTotal = expenseTotalAgg._sum.amount ?? 0;

    const netProfit = grossProfit - expensesTotal;
    const netMargin = revenueTotal > 0 ? (netProfit / revenueTotal) * 100 : 0;

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      revenue: { sales, otherIncome, total: revenueTotal },
      cogs: { totalCost },
      grossProfit,
      grossMargin,
      expenses: { byCategory: expensesByCategory, total: expensesTotal },
      netProfit,
      netMargin,
    };
  }

  private bucketKey(date: Date, groupBy: "day" | "week" | "month"): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    if (groupBy === "day") return `${y}-${m}-${d}`;
    if (groupBy === "month") return `${y}-${m}`;
    // week: ISO week
    const tmp = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(
      ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }

  private computeAgingBucket(
    dueDate: Date | null,
    now: Date,
  ): AgingBucketKey {
    if (!dueDate || dueDate.getTime() >= now.getTime()) return "current";
    const overdueDays = Math.floor(
      (now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (overdueDays <= 30) return "1-30";
    if (overdueDays <= 60) return "31-60";
    if (overdueDays <= 90) return "61-90";
    return "90+";
  }

  // ===== Hourly / Category / Supplier / Overview / Cashier =====

  async hourlySales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ): Promise<Array<{ hour: string; total: number; transactions: number }>> {
    const now = new Date();
    const start = dateFrom
      ? new Date(dateFrom)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = dateTo ? new Date(dateTo) : new Date();
    end.setHours(23, 59, 59, 999);

    const rows = await this.repo.findHourlySales(start, end, branchId, companyId);

    const map = new Map(
      rows.map((r) => [
        r.h,
        { total: Number(r.total), transactions: Number(r.count) },
      ]),
    );
    return Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, "0")}:00`,
      ...(map.get(h) ?? { total: 0, transactions: 0 }),
    }));
  }

  async categorySales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    const { where, params } = this.buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [rows, topRows] = await Promise.all([
      this.repo.findCategorySales(where, params),
      this.repo.findCategoryTopProducts(where, params),
    ]);

    const topMap = new Map<
      string,
      Array<{ name: string; quantity: number; revenue: number }>
    >();
    for (const r of topRows) {
      const list = topMap.get(r.categoryId) ?? [];
      list.push({
        name: r.productName,
        quantity: r.quantity,
        revenue: r.revenue,
      });
      topMap.set(r.categoryId, list);
    }
    return rows.map((cat) => ({
      ...cat,
      profit: cat.totalRevenue - cat.totalCost,
      topProducts: topMap.get(cat.categoryId) ?? [],
    }));
  }

  async supplierSales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    const { where, params } = this.buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [rows, topRows] = await Promise.all([
      this.repo.findSupplierSales(where, params),
      this.repo.findSupplierTopProducts(where, params),
    ]);

    const topMap = new Map<
      string,
      Array<{ name: string; quantity: number; revenue: number }>
    >();
    for (const r of topRows) {
      const key = r.supplierId ?? "null";
      const list = topMap.get(key) ?? [];
      list.push({
        name: r.productName,
        quantity: r.quantity,
        revenue: r.revenue,
      });
      topMap.set(key, list);
    }
    return rows.map((sup) => ({
      ...sup,
      profit: sup.totalRevenue - sup.totalCost,
      topProducts: topMap.get(sup.supplierId ?? "null") ?? [],
    }));
  }

  async overview(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    const { where, params } = this.buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [totals, topCashiers, categoryRows, itemCount] = await Promise.all([
      this.repo.findOverviewTotals(where, params),
      this.repo.findOverviewTopCashiers(where, params),
      this.repo.findOverviewCategorySales(where, params),
      this.repo.findOverviewItemCount(where, params),
    ]);
    const agg = totals[0] ?? { revenue: 0, discount: 0, tax: 0, txCount: 0 };
    return {
      revenue: agg.revenue,
      transactions: agg.txCount,
      totalItemsSold: itemCount[0]?.total ?? 0,
      averageTicket: agg.txCount > 0 ? agg.revenue / agg.txCount : 0,
      totalDiscount: agg.discount,
      totalTax: agg.tax,
      topCashiers,
      categorySales: categoryRows,
    };
  }

  async cashierSales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    const { where, params } = this.buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [txRows, itemRows] = await Promise.all([
      this.repo.findCashierTransactions(where, params),
      this.repo.findCashierItems(where, params),
    ]);
    const itemMap = new Map(itemRows.map((r) => [r.userId, r]));
    return txRows
      .map((c) => {
        const items = itemMap.get(c.userId) ?? { totalCost: 0, itemsSold: 0 };
        return {
          userId: c.userId,
          name: c.name,
          email: c.email,
          role: c.role,
          totalRevenue: c.totalRevenue,
          totalCost: items.totalCost,
          profit: c.totalRevenue - items.totalCost,
          totalDiscount: c.totalDiscount,
          transactionCount: c.transactionCount,
          itemsSold: items.itemsSold,
          averageTicket:
            c.transactionCount > 0
              ? Math.round(c.totalRevenue / c.transactionCount)
              : 0,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  private buildSalesViewWhere(
    dateFrom: string | undefined,
    dateTo: string | undefined,
    branchId: string | undefined,
    alias: string,
    companyId: string,
  ): { where: string; params: unknown[] } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (dateFrom) {
      params.push(new Date(dateFrom + "T00:00:00"));
      conds.push(`${alias}."txCreatedAt" >= $${params.length}`);
    }
    if (dateTo) {
      params.push(new Date(dateTo + "T23:59:59"));
      conds.push(`${alias}."txCreatedAt" <= $${params.length}`);
    }
    if (branchId) {
      params.push(branchId);
      conds.push(`${alias}."branchId" = $${params.length}`);
    }
    params.push(companyId);
    conds.push(`${alias}."companyId" = $${params.length}`);
    return { where: conds.join(" AND "), params };
  }
}
