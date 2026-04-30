import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CustomerReportQueryDto,
  CustomerReportResponse,
  PaymentMethodReportQueryDto,
  PaymentMethodReportResponse,
  ProductReportQueryDto,
  ProductReportResponse,
  SalesReportQueryDto,
  SalesReportResponse,
  SalesReportSeriesEntry,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { bucketKey } from "./reports.helpers";

@Injectable()
export class CoreReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
      const periodKey = bucketKey(t.createdAt, groupBy);
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
}
