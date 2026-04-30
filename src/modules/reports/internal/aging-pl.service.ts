import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AgingBucketKey,
  AgingBucketSummary,
  AgingCustomerEntry,
  AgingReportQueryDto,
  AgingReportResponse,
  ProfitLossReportQueryDto,
  ProfitLossReportResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { computeAgingBucket } from "./reports.helpers";

@Injectable()
export class AgingPLReportService {
  constructor(private readonly prisma: PrismaService) {}

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
      const bucket = computeAgingBucket(d.dueDate, now);
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
}
