import { Injectable } from "@nestjs/common";
import type {
  CategoryMarginResponse,
  DeadStockItemResponse,
  MarginProductResponse,
  PeakHourEntry,
  ReorderAlertResponse,
  ReorderRecommendationResponse,
  SlowMovingItemResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";

const SLOW_MOVING_THRESHOLD_QTY = 5;
const SLOW_MOVING_DAYS = 30;
const REORDER_RECOMMEND_DAYS = 30;

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMarginAnalysis(
    companyId: string,
    _branchId?: string,
  ): Promise<MarginProductResponse[]> {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, companyId },
      select: {
        id: true,
        name: true,
        code: true,
        purchasePrice: true,
        sellingPrice: true,
        stock: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      stock: p.stock,
      category: p.category ? { name: p.category.name } : null,
      margin: p.sellingPrice - p.purchasePrice,
      marginPercent:
        p.purchasePrice > 0
          ? ((p.sellingPrice - p.purchasePrice) / p.purchasePrice) * 100
          : 0,
    }));
  }

  async getCategoryMarginAnalysis(
    companyId: string,
    _branchId?: string,
  ): Promise<CategoryMarginResponse[]> {
    const categories = await this.prisma.category.findMany({
      where: { companyId },
      include: {
        products: {
          where: { isActive: true },
          select: { purchasePrice: true, sellingPrice: true, stock: true },
        },
      },
    });

    return categories.map((c) => {
      const totalCost = c.products.reduce((sum, p) => sum + p.purchasePrice, 0);
      const totalSell = c.products.reduce((sum, p) => sum + p.sellingPrice, 0);
      const avgMargin =
        c.products.length > 0
          ? c.products.reduce(
              (sum, p) => sum + (p.sellingPrice - p.purchasePrice),
              0,
            ) / c.products.length
          : 0;
      const totalStock = c.products.reduce((sum, p) => sum + p.stock, 0);

      return {
        name: c.name,
        productCount: c.products.length,
        avgCost: c.products.length > 0 ? totalCost / c.products.length : 0,
        avgSell: c.products.length > 0 ? totalSell / c.products.length : 0,
        avgMargin,
        avgMarginPercent:
          totalCost > 0 ? ((totalSell - totalCost) / totalCost) * 100 : 0,
        totalStock,
      };
    });
  }

  async getDeadStock(
    companyId: string,
    _branchId?: string,
  ): Promise<DeadStockItemResponse[]> {
    const thirtyDaysAgo = daysAgo(30);

    const allProducts = await this.prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 }, companyId },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        sellingPrice: true,
        category: { select: { name: true } },
      },
    });

    const recentSales = await this.prisma.transactionItem.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
        transaction: { branch: { companyId } },
      },
      select: { productId: true },
      distinct: ["productId"],
    });

    const soldProductIds = new Set(recentSales.map((s) => s.productId));

    return allProducts
      .filter((p) => !soldProductIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        stock: p.stock,
        sellingPrice: p.sellingPrice,
        category: p.category ? { name: p.category.name } : null,
        stockValue: p.stock * p.sellingPrice,
      }));
  }

  async getSlowMoving(
    companyId: string,
    branchId?: string,
  ): Promise<SlowMovingItemResponse[]> {
    const thirtyDaysAgo = daysAgo(SLOW_MOVING_DAYS);

    const params: unknown[] = [thirtyDaysAgo];
    const branchCond = branchId
      ? `AND t."branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    const slowRows = await this.prisma.$queryRawUnsafe<
      { productId: string; soldQty: number }[]
    >(
      `
      SELECT
        ti."productId",
        COALESCE(SUM(ti.quantity), 0)::int AS "soldQty"
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= $1
        ${branchCond}
        ${companyCond}
      GROUP BY ti."productId"
      HAVING COALESCE(SUM(ti.quantity), 0) < ${SLOW_MOVING_THRESHOLD_QTY}
      ORDER BY "soldQty" ASC
      LIMIT 50
      `,
      ...params,
    );

    const slowIds = slowRows.map((r) => r.productId);
    if (slowIds.length === 0) return [];

    const qtyMap = new Map(slowRows.map((r) => [r.productId, r.soldQty]));
    const products = await this.prisma.product.findMany({
      where: { id: { in: slowIds }, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        category: { select: { name: true } },
      },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      category: p.category ? { name: p.category.name } : null,
      soldQty: qtyMap.get(p.id) ?? 0,
    }));
  }

  async getPeakHours(
    companyId: string,
    branchId?: string,
  ): Promise<PeakHourEntry[]> {
    const thirtyDaysAgo = daysAgo(30);

    const params: unknown[] = [thirtyDaysAgo];
    const branchCond = branchId
      ? `AND "branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    const rows = await this.prisma.$queryRawUnsafe<
      { h: number; count: bigint; revenue: bigint }[]
    >(
      `
      SELECT EXTRACT(HOUR FROM "createdAt")::int as h,
             COUNT(*)::bigint as count,
             COALESCE(SUM("grandTotal"), 0) as revenue
      FROM transactions
      WHERE status = 'COMPLETED' AND "createdAt" >= $1 ${branchCond} ${companyCond}
      GROUP BY EXTRACT(HOUR FROM "createdAt")
      ORDER BY h
      `,
      ...params,
    );

    const hourMap = new Map(
      rows.map((r) => [
        r.h,
        { count: Number(r.count), revenue: Number(r.revenue) },
      ]),
    );

    return Array.from({ length: 24 }, (_, h) => {
      const data = hourMap.get(h) || { count: 0, revenue: 0 };
      return {
        hour: `${String(h).padStart(2, "0")}:00`,
        transactions: data.count,
        revenue: data.revenue,
      };
    });
  }

  async getReorderAlerts(
    companyId: string,
    _branchId?: string,
  ): Promise<ReorderAlertResponse[]> {
    return this.prisma.$queryRawUnsafe<ReorderAlertResponse[]>(
      `
      SELECT p.id, p.name, p.code, p.stock, p."minStock",
             s.name as "supplierName"
      FROM products p
      LEFT JOIN suppliers s ON p."supplierId" = s.id
      WHERE p."isActive" = true AND p.stock <= p."minStock"
        AND p."companyId" = $1
      ORDER BY (p.stock::float / NULLIF(p."minStock", 0)) ASC
      LIMIT 20
      `,
      companyId,
    );
  }

  async getReorderRecommendations(
    companyId: string,
    _branchId?: string,
  ): Promise<ReorderRecommendationResponse[]> {
    const thirtyDaysAgo = daysAgo(REORDER_RECOMMEND_DAYS);

    const lowStockProducts = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        name: string;
        code: string;
        stock: number;
        minStock: number;
        supplierName: string | null;
      }[]
    >(
      `
      SELECT p.id, p.name, p.code, p.stock, p."minStock",
             s.name as "supplierName"
      FROM products p
      LEFT JOIN suppliers s ON p."supplierId" = s.id
      WHERE p."isActive" = true AND p.stock <= p."minStock"
        AND p."companyId" = $1
      ORDER BY (p.stock::float / NULLIF(p."minStock", 0)) ASC
      `,
      companyId,
    );

    const productIds = lowStockProducts.map((p) => p.id);
    const salesAgg =
      productIds.length > 0
        ? await this.prisma.transactionItem.groupBy({
            by: ["productId"],
            where: {
              productId: { in: productIds },
              createdAt: { gte: thirtyDaysAgo },
              transaction: { status: "COMPLETED" },
            },
            _sum: { quantity: true },
          })
        : [];

    const salesMap = new Map(
      salesAgg.map((s) => [s.productId, s._sum.quantity || 0]),
    );

    const results = lowStockProducts.map((p) => {
      const totalSold = salesMap.get(p.id) || 0;
      const avgDailySales = totalSold / REORDER_RECOMMEND_DAYS;
      const daysUntilOut =
        avgDailySales > 0
          ? Math.round(p.stock / avgDailySales)
          : p.stock > 0
            ? 999
            : 0;
      const recommendedQty = Math.max(p.minStock * 2 - p.stock, 0);

      return {
        product: p.name,
        code: p.code,
        currentStock: p.stock,
        minStock: p.minStock,
        avgDailySales: Math.round(avgDailySales * 100) / 100,
        daysUntilOut,
        recommendedQty,
        supplier: p.supplierName || "-",
      };
    });

    return results.sort((a, b) => a.daysUntilOut - b.daysUntilOut);
  }
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
