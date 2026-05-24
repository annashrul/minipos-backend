import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AutoReorderQueryDto,
  DailySalesPointResponse,
  ForecastProductResponse,
  ForecastSummaryQueryDto,
  ForecastSummaryResponse,
  InventoryForecastQueryDto,
  ProductSalesTrendQueryDto,
  ReorderItemResponse,
  RiskLevelDto,
  SalesTrendDto,
  SupplierReorderGroupResponse,
} from "./dto/inventory-forecast.dto";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_LEAD_TIME_DAYS = 7;

function classifyRisk(daysLeft: number): RiskLevelDto {
  if (daysLeft < 3) return "CRITICAL";
  if (daysLeft < 7) return "WARNING";
  if (daysLeft < 14) return "LOW";
  return "SAFE";
}

function classifyTrend(recentAvg: number, priorAvg: number): SalesTrendDto {
  if (priorAvg === 0 && recentAvg === 0) return "STABLE";
  if (priorAvg === 0) return "INCREASING";
  const ratio = recentAvg / priorAvg;
  if (ratio > 1.15) return "INCREASING";
  if (ratio < 0.85) return "DECREASING";
  return "STABLE";
}

@Injectable()
export class InventoryForecastService {
  constructor(private readonly prisma: PrismaService) {}

  async getForecast(
    companyId: string,
    query: InventoryForecastQueryDto,
  ): Promise<ForecastProductResponse[]> {
    const {
      branchId,
      riskLevel,
      search,
      categoryId,
      supplierId,
      sortBy = "daysLeft",
      sortDir = "asc",
      leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
    } = query;

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fifteenDaysAgo = new Date(now);
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const salesParams1: unknown[] = [thirtyDaysAgo];
    const salesParams2: unknown[] = [fifteenDaysAgo];
    const salesParams3: unknown[] = [thirtyDaysAgo, fifteenDaysAgo];
    let branchCondition1 = "";
    let branchCondition2 = "";
    let branchCondition3 = "";
    if (branchId) {
      salesParams1.push(branchId);
      branchCondition1 = `AND t."branchId" = $${salesParams1.length}`;
      salesParams2.push(branchId);
      branchCondition2 = `AND t."branchId" = $${salesParams2.length}`;
      salesParams3.push(branchId);
      branchCondition3 = `AND t."branchId" = $${salesParams3.length}`;
    }

    const salesData = await this.prisma.$queryRawUnsafe<
      { productId: string; total_sold: bigint; active_days: bigint }[]
    >(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold,
               COUNT(DISTINCT DATE_TRUNC('day', t."createdAt")) as active_days
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          ${branchCondition1}
        GROUP BY ti."productId"
      `,
      ...salesParams1,
    );

    const recentSalesData = await this.prisma.$queryRawUnsafe<
      { productId: string; total_sold: bigint }[]
    >(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          ${branchCondition2}
        GROUP BY ti."productId"
      `,
      ...salesParams2,
    );

    const priorSalesData = await this.prisma.$queryRawUnsafe<
      { productId: string; total_sold: bigint }[]
    >(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          AND t."createdAt" < $2
          ${branchCondition3}
        GROUP BY ti."productId"
      `,
      ...salesParams3,
    );

    const salesMap = new Map(
      salesData.map((r) => [
        r.productId,
        {
          totalSold: Number(r.total_sold),
          activeDays: Number(r.active_days),
        },
      ]),
    );
    const recentMap = new Map(
      recentSalesData.map((r) => [r.productId, Number(r.total_sold)]),
    );
    const priorMap = new Map(
      priorSalesData.map((r) => [r.productId, Number(r.total_sold)]),
    );

    const productWhere: Prisma.ProductWhereInput = {
      isActive: true,
      deletedAt: null,
      companyId,
    };
    if (categoryId) productWhere.categoryId = categoryId;
    if (supplierId) productWhere.supplierId = supplierId;
    if (search) {
      productWhere.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where: productWhere,
      include: {
        category: { select: { name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });

    let results: ForecastProductResponse[] = products.map((p) => {
      const sales = salesMap.get(p.id) || { totalSold: 0, activeDays: 0 };
      const avgDaily = sales.activeDays > 0 ? sales.totalSold / 30 : 0;
      const daysLeft = avgDaily > 0 ? Math.round(p.stock / avgDaily) : 9999;
      const reorderQty = Math.max(
        0,
        Math.ceil(avgDaily * (leadTimeDays + 14) - p.stock),
      );

      const recentTotal = recentMap.get(p.id) || 0;
      const priorTotal = priorMap.get(p.id) || 0;
      const recentAvg = recentTotal / 15;
      const priorAvg = priorTotal / 15;

      return {
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        categoryName: p.category.name,
        supplierName: p.supplier?.name || null,
        supplierId: p.supplier?.id || null,
        currentStock: p.stock,
        minStock: p.minStock,
        purchasePrice: p.purchasePrice,
        sellingPrice: p.sellingPrice,
        avgDailySales: Math.round(avgDaily * 100) / 100,
        daysUntilStockout: daysLeft,
        recommendedReorderQty: reorderQty,
        trend: classifyTrend(recentAvg, priorAvg),
        riskLevel: classifyRisk(daysLeft),
        totalSold30d: sales.totalSold,
        activeDays30d: sales.activeDays,
      };
    });

    if (riskLevel) {
      results = results.filter((r) => r.riskLevel === riskLevel);
    }

    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "daysLeft":
          cmp = a.daysUntilStockout - b.daysUntilStockout;
          break;
        case "avgSales":
          cmp = a.avgDailySales - b.avgDailySales;
          break;
        case "stock":
          cmp = a.currentStock - b.currentStock;
          break;
        case "name":
          cmp = a.productName.localeCompare(b.productName);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return results;
  }

  async getSummary(
    companyId: string,
    query: ForecastSummaryQueryDto,
  ): Promise<ForecastSummaryResponse> {
    const all = await this.getForecast(companyId, {
      branchId: query.branchId,
    } as InventoryForecastQueryDto);

    let criticalCount = 0;
    let warningCount = 0;
    let lowCount = 0;
    let safeCount = 0;
    let totalStockValueAtRisk = 0;
    let productsNeedingReorder = 0;

    for (const p of all) {
      switch (p.riskLevel) {
        case "CRITICAL":
          criticalCount++;
          break;
        case "WARNING":
          warningCount++;
          break;
        case "LOW":
          lowCount++;
          break;
        case "SAFE":
          safeCount++;
          break;
      }
      if (p.riskLevel === "CRITICAL" || p.riskLevel === "WARNING") {
        totalStockValueAtRisk += p.currentStock * p.purchasePrice;
      }
      if (p.recommendedReorderQty > 0) {
        productsNeedingReorder++;
      }
    }

    return {
      criticalCount,
      warningCount,
      lowCount,
      safeCount,
      totalStockValueAtRisk,
      productsNeedingReorder,
      totalProducts: all.length,
    };
  }

  async getProductSalesTrend(
    _companyId: string,
    query: ProductSalesTrendQueryDto,
  ): Promise<DailySalesPointResponse[]> {
    const { productId, days, branchId } = query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const trendParams: unknown[] = [productId, startDate];
    let trendBranchCondition = "";
    if (branchId) {
      trendParams.push(branchId);
      trendBranchCondition = `AND t."branchId" = $${trendParams.length}`;
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { sale_date: Date; daily_qty: bigint }[]
    >(
      `
        SELECT DATE_TRUNC('day', t."createdAt") as sale_date,
               SUM(ti.quantity) as daily_qty
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND ti."productId" = $1
          AND t."createdAt" >= $2
          ${trendBranchCondition}
        GROUP BY DATE_TRUNC('day', t."createdAt")
        ORDER BY sale_date ASC
      `,
      ...trendParams,
    );

    const result: DailySalesPointResponse[] = [];
    const salesMap = new Map(
      rows.map((r) => [
        new Date(r.sale_date).toISOString().split("T")[0] ?? "",
        Number(r.daily_qty),
      ]),
    );

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toISOString().split("T")[0] ?? "";
      result.push({
        date: key,
        quantity: salesMap.get(key) ?? 0,
      });
    }

    return result;
  }

  async generateAutoReorderList(
    companyId: string,
    query: AutoReorderQueryDto,
  ): Promise<SupplierReorderGroupResponse[]> {
    const all = await this.getForecast(companyId, {
      branchId: query.branchId,
      sortBy: "daysLeft",
      sortDir: "asc",
    } as InventoryForecastQueryDto);

    const needsReorder = all.filter(
      (p) => p.recommendedReorderQty > 0 && p.daysUntilStockout < 14,
    );

    const groups = new Map<
      string,
      {
        supplier: {
          id: string;
          name: string;
          contact: string | null;
          email: string | null;
        };
        items: ReorderItemResponse[];
      }
    >();

    const supplierIds = [
      ...new Set(
        needsReorder
          .filter((p) => p.supplierId)
          .map((p) => p.supplierId as string),
      ),
    ];
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds }, companyId },
          select: { id: true, name: true, contact: true, email: true },
        })
      : [];
    const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

    for (const p of needsReorder) {
      const suppId = p.supplierId || "unassigned";
      const supp = p.supplierId ? supplierMap.get(p.supplierId) : null;

      if (!groups.has(suppId)) {
        groups.set(suppId, {
          supplier: {
            id: suppId,
            name: supp?.name || "Tanpa Supplier",
            contact: supp?.contact || null,
            email: supp?.email || null,
          },
          items: [],
        });
      }

      groups.get(suppId)!.items.push({
        productId: p.productId,
        productName: p.productName,
        productCode: p.productCode,
        currentStock: p.currentStock,
        avgDailySales: p.avgDailySales,
        daysUntilStockout: p.daysUntilStockout,
        recommendedQty: p.recommendedReorderQty,
        estimatedCost: p.recommendedReorderQty * p.purchasePrice,
        purchasePrice: p.purchasePrice,
        riskLevel: p.riskLevel,
      });
    }

    return Array.from(groups.values())
      .map((g) => ({
        supplierId: g.supplier.id,
        supplierName: g.supplier.name,
        supplierContact: g.supplier.contact,
        supplierEmail: g.supplier.email,
        items: g.items,
        totalEstimatedCost: g.items.reduce(
          (sum, i) => sum + i.estimatedCost,
          0,
        ),
      }))
      .sort((a, b) => {
        const aCrit = a.items.filter((i) => i.riskLevel === "CRITICAL").length;
        const bCrit = b.items.filter((i) => i.riskLevel === "CRITICAL").length;
        return bCrit - aCrit;
      });
  }
}
