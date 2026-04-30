import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  DashboardStatsQueryDto,
  DashboardStatsResponse,
  DashboardTopCustomer,
  DashboardTopProduct,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  RangeBounds,
  resolvePrevRange,
  resolveRange,
} from "./dashboard.helpers";

@Injectable()
export class DashboardStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(
    companyId: string,
    query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResponse> {
    const { branchId, period } = query;
    const range = resolveRange(period);
    const prevRange = resolvePrevRange(period, range);

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
          where: { ...where, customerId: { not: null } },
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
      name: c.customerId ? customerMap.get(c.customerId) ?? "" : "",
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
        comparePrev: { total: prevTotal, change, changePercent },
      },
      topProducts,
      topCustomers,
      paymentBreakdown,
      hourlyTrend,
    };
  }

  private async computeHourlyTrend(
    where: Prisma.TransactionWhereInput,
    _range: RangeBounds,
  ): Promise<DashboardStatsResponse["hourlyTrend"]> {
    const transactions = await this.prisma.transaction.findMany({
      where,
      select: { createdAt: true, grandTotal: true },
    });

    const buckets = new Map<number, { sales: number; count: number }>();
    for (let i = 0; i < 24; i++) buckets.set(i, { sales: 0, count: 0 });

    for (const t of transactions) {
      const hour = t.createdAt.getHours();
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
}
