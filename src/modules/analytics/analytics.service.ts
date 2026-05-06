import { Injectable } from "@nestjs/common";
import type {
  ActivePromotionResponse,
  AppliedPromoResponse,
  CalculateAutoPromoDto,
  CalculateAutoPromoResponse,
  CashierPerformanceEntry,
  CategoryMarginResponse,
  CustomerFavoriteResponse,
  DailyProfitEntry,
  DeadStockItemResponse,
  FindCustomerByPhoneResponse,
  LoyaltySummaryResponse,
  MarginProductResponse,
  PeakHourEntry,
  PromoEffectivenessResponse,
  RepeatCustomerResponse,
  ReorderAlertResponse,
  ReorderRecommendationResponse,
  ShiftProfitEntry,
  ShoppingFrequencyCustomerResponse,
  SlowMovingItemResponse,
  SupplierDebtResponse,
  SupplierRankingResponse,
  TebusMurahOptionResponse,
  TebusMurahOptionsDto,
  UnusualDiscountResponse,
  ValidateVoucherDto,
  ValidateVoucherResponse,
  VoidAbuseEntryResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================
  // Margin analyzers
  // ===========================

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

  // ===========================
  // Stock detection
  // ===========================

  async getDeadStock(
    companyId: string,
    _branchId?: string,
  ): Promise<DeadStockItemResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
      HAVING COALESCE(SUM(ti.quantity), 0) < 5
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

  // ===========================
  // Sales trends
  // ===========================

  async getPeakHours(
    companyId: string,
    branchId?: string,
  ): Promise<PeakHourEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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

  // ===========================
  // Reorder
  // ===========================

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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
      const avgDailySales = totalSold / 30;
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

  // ===========================
  // Fraud detection
  // ===========================

  async getVoidAbuseDetection(
    companyId: string,
    _branchId?: string,
  ): Promise<VoidAbuseEntryResponse[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rows = await this.prisma.$queryRawUnsafe<
      { name: string; role: string; voidCount: number }[]
    >(
      `
        SELECT u.name, u.role, COUNT(t.id)::int AS "voidCount"
        FROM transactions t
        JOIN users u ON u.id = t."userId"
        WHERE t.status = 'VOIDED' AND t."createdAt" >= $1
          AND u."companyId" = $2
        GROUP BY u.id, u.name, u.role
        ORDER BY "voidCount" DESC
        `,
      sevenDaysAgo,
      companyId,
    );

    return rows.map((r) => ({
      userName: r.name,
      role: r.role,
      voidCount: r.voidCount,
      suspicious: r.voidCount > 5,
    }));
  }

  async getUnusualDiscounts(
    companyId: string,
    _branchId?: string,
  ): Promise<UnusualDiscountResponse[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const transactions = await this.prisma.$queryRawUnsafe<
      {
        invoiceNumber: string;
        invoiceDisplayNumber: string | null;
        cashierName: string;
        role: string;
        subtotal: number;
        discountAmount: number;
        grandTotal: number;
        createdAt: string;
      }[]
    >(
      `
      SELECT t."invoiceNumber",
             t."invoiceDisplayNumber",
             u.name AS "cashierName",
             u.role,
             t.subtotal,
             t."discountAmount",
             t."grandTotal",
             t."createdAt"::text
      FROM transactions t
      JOIN users u ON u.id = t."userId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= $1
        AND t."discountAmount" > 0
        AND t.subtotal > 0
        AND (t."discountAmount" / t.subtotal) * 100 > 20
        AND u."companyId" = $2
      ORDER BY t."discountAmount" DESC
      `,
      sevenDaysAgo,
      companyId,
    );

    return transactions.map((tx) => ({
      invoiceNumber: tx.invoiceDisplayNumber || tx.invoiceNumber,
      cashier: tx.cashierName,
      role: tx.role,
      subtotal: tx.subtotal,
      discountAmount: tx.discountAmount,
      discountPercent: (tx.discountAmount / tx.subtotal) * 100,
      grandTotal: tx.grandTotal,
      createdAt: tx.createdAt,
    }));
  }

  // ===========================
  // Profit
  // ===========================

  async getDailyProfit(
    companyId: string,
    _branchId?: string,
  ): Promise<DailyProfitEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await this.prisma.$queryRawUnsafe<
      { d: Date; revenue: bigint; cost: bigint }[]
    >(
      `
      SELECT DATE_TRUNC('day', t."createdAt") as d,
             COALESCE(SUM(t."grandTotal"), 0) as revenue,
             COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) as cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t.id
      JOIN products p ON p.id = ti."productId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1
        AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $2)
      GROUP BY DATE_TRUNC('day', t."createdAt")
      ORDER BY d ASC
    `,
      thirtyDaysAgo,
      companyId,
    );

    return rows.map((r) => ({
      date: new Date(r.d).toISOString().split("T")[0] ?? "",
      revenue: Number(r.revenue),
      cost: Number(r.cost),
      profit: Number(r.revenue) - Number(r.cost),
    }));
  }

  async getShiftProfit(
    companyId: string,
    _branchId?: string,
  ): Promise<ShiftProfitEntry[]> {
    const shifts = await this.prisma.cashierShift.findMany({
      where: { isOpen: false, closedAt: { not: null }, branch: { companyId } },
      include: { user: { select: { name: true } } },
      orderBy: { closedAt: "desc" },
      take: 30,
    });
    if (shifts.length === 0) return [];
    const rows = await this.prisma.$queryRawUnsafe<
      { shiftId: string; revenue: number; txCount: number }[]
    >(
      `SELECT cs.id as "shiftId",
              COALESCE(SUM(t."grandTotal"), 0)::float AS revenue,
              COUNT(t.id)::int AS "txCount"
       FROM cashier_shifts cs
       LEFT JOIN transactions t ON t."userId" = cs."userId"
                                AND t.status = 'COMPLETED'
                                AND t."createdAt" >= cs."openedAt"
                                AND t."createdAt" <= cs."closedAt"
       WHERE cs.id = ANY($1)
       GROUP BY cs.id`,
      shifts.map((s) => s.id),
    );
    const rowMap = new Map(rows.map((r) => [r.shiftId, r]));
    return shifts.map((shift) => {
      const agg = rowMap.get(shift.id) ?? { revenue: 0, txCount: 0 };
      return {
        shiftId: shift.id,
        cashier: shift.user.name,
        openedAt: shift.openedAt.toISOString(),
        closedAt: (shift.closedAt as Date).toISOString(),
        revenue: agg.revenue,
        transactions: agg.txCount,
      };
    });
  }

  // ===========================
  // Suppliers
  // ===========================

  async getSupplierRanking(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierRankingResponse[]> {
    return this.prisma.$queryRawUnsafe<SupplierRankingResponse[]>(
      `
      SELECT s.name,
             COUNT(DISTINCT p.id)::int AS "productCount",
             COALESCE(SUM(po."totalAmount"), 0)::float AS "totalPOValue",
             COUNT(DISTINCT po.id)::int AS "poCount"
      FROM suppliers s
      LEFT JOIN products p ON p."supplierId" = s.id AND p."isActive" = true
      LEFT JOIN purchase_orders po ON po."supplierId" = s.id
      WHERE s."isActive" = true AND s."companyId" = $1
      GROUP BY s.id, s.name
      ORDER BY "totalPOValue" DESC
      `,
      companyId,
    );
  }

  async getSupplierDebt(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierDebtResponse[]> {
    return this.prisma.$queryRawUnsafe<SupplierDebtResponse[]>(
      `
      SELECT
        s.name as "supplierName",
        COALESCE((
          SELECT SUM(po."totalAmount")
          FROM purchase_orders po
          WHERE po."supplierId" = s.id
            AND po.status = 'RECEIVED'
        ), 0)::float as "totalPO",
        COALESCE((
          SELECT SUM(sp.amount)
          FROM supplier_payments sp
          WHERE sp."supplierId" = s.id
        ), 0)::float as "totalPaid",
        (
          COALESCE((
            SELECT SUM(po."totalAmount")
            FROM purchase_orders po
            WHERE po."supplierId" = s.id
              AND po.status = 'RECEIVED'
          ), 0) -
          COALESCE((
            SELECT SUM(sp.amount)
            FROM supplier_payments sp
            WHERE sp."supplierId" = s.id
          ), 0)
        )::float as debt
      FROM suppliers s
      WHERE s."isActive" = true AND s."companyId" = $1
      ORDER BY debt DESC
      `,
      companyId,
    );
  }

  // ===========================
  // Promo effectiveness
  // ===========================

  async getPromoEffectiveness(
    companyId: string,
    _branchId?: string,
  ): Promise<PromoEffectivenessResponse[]> {
    const [promotions, txAgg] = await Promise.all([
      this.prisma.promotion.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.$queryRaw<
        { promoApplied: string; usageCount: number; totalDiscount: number }[]
      >`
          SELECT "promoApplied",
                 COUNT(*)::int AS "usageCount",
                 COALESCE(SUM("discountAmount"), 0)::float AS "totalDiscount"
          FROM transactions
          WHERE status = 'COMPLETED' AND "promoApplied" IS NOT NULL
          GROUP BY "promoApplied"
      `,
    ]);

    const txMap = new Map(txAgg.map((r) => [r.promoApplied, r]));

    return promotions
      .map((promo) => {
        const key = promo.voucherCode ?? promo.name;
        const agg = txMap.get(key) ?? { usageCount: 0, totalDiscount: 0 };
        return {
          promoName: promo.name,
          type: promo.type,
          usageCount: Math.max(agg.usageCount, promo.usageCount),
          totalDiscount: agg.totalDiscount,
          isActive: promo.isActive && new Date(promo.endDate) >= new Date(),
        };
      })
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  // ===========================
  // Cashier performance
  // ===========================

  async getCashierPerformance(
    companyId: string,
    _branchId?: string,
  ): Promise<CashierPerformanceEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return this.prisma.$queryRawUnsafe<CashierPerformanceEntry[]>(
      `
      SELECT u.name,
             COUNT(t.id)::int AS transactions,
             COALESCE(SUM(t."grandTotal"), 0)::float AS revenue,
             COALESCE(AVG(t."grandTotal"), 0)::float AS "avgTransaction"
      FROM transactions t
      JOIN users u ON u.id = t."userId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1
        AND u."companyId" = $2
      GROUP BY u.id, u.name
      ORDER BY revenue DESC
      `,
      thirtyDaysAgo,
      companyId,
    );
  }

  // ===========================
  // Customer Intelligence
  // ===========================

  async getRepeatCustomers(
    companyId: string,
    _branchId?: string,
  ): Promise<RepeatCustomerResponse[]> {
    const customers = await this.prisma.customer.findMany({
      where: { companyId },
      include: {
        _count: { select: { transactions: true } },
      },
      orderBy: { totalSpending: "desc" },
      take: 20,
    });

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      memberLevel: c.memberLevel,
      totalSpending: c.totalSpending,
      points: c.points,
      transactionCount: c._count.transactions,
      isRepeat: c._count.transactions > 1,
    }));
  }

  async getCustomerFavorites(
    customerId: string,
    _branchId?: string,
  ): Promise<CustomerFavoriteResponse[]> {
    const items = await this.prisma.transactionItem.groupBy({
      by: ["productId", "productName"],
      where: {
        transaction: { customerId },
      },
      _sum: { quantity: true, subtotal: true },
      _count: true,
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });

    return items.map((i) => ({
      productName: i.productName,
      productId: i.productId,
      totalQty: i._sum.quantity || 0,
      totalSpent: i._sum.subtotal || 0,
      purchaseCount: i._count,
    }));
  }

  async getShoppingFrequency(
    companyId: string,
    _branchId?: string,
  ): Promise<ShoppingFrequencyCustomerResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        transactions: { some: { createdAt: { gte: thirtyDaysAgo } } },
      },
      include: {
        transactions: {
          where: { createdAt: { gte: thirtyDaysAgo }, status: "COMPLETED" },
          select: { createdAt: true, grandTotal: true },
          orderBy: { createdAt: "desc" },
        },
      },
      take: 20,
    });

    return customers
      .map((c) => {
        const txCount = c.transactions.length;
        const totalSpent = c.transactions.reduce(
          (sum, tx) => sum + tx.grandTotal,
          0,
        );
        const lastVisit = c.transactions[0]?.createdAt ?? null;
        const avgSpending = txCount > 0 ? totalSpent / txCount : 0;

        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          memberLevel: c.memberLevel,
          visitCount: txCount,
          totalSpent,
          avgSpending,
          lastVisit: lastVisit ? lastVisit.toISOString() : null,
        };
      })
      .sort((a, b) => b.visitCount - a.visitCount);
  }

  async getLoyaltySummary(
    companyId: string,
    _branchId?: string,
  ): Promise<LoyaltySummaryResponse[]> {
    const levels = await this.prisma.customer.groupBy({
      by: ["memberLevel"],
      where: { companyId },
      _count: true,
      _sum: { totalSpending: true, points: true },
    });

    return levels.map((l) => ({
      level: l.memberLevel,
      count: l._count,
      totalSpending: l._sum.totalSpending || 0,
      totalPoints: l._sum.points || 0,
    }));
  }

  // ===========================
  // Promo Engine
  // ===========================

  async getActivePromotions(
    companyId: string,
  ): Promise<ActivePromotionResponse[]> {
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    return promos.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      value: p.value,
      minPurchase: p.minPurchase,
      maxDiscount: p.maxDiscount,
      scope: p.scope,
      categoryId: p.categoryId,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      productId: p.productId,
      product: p.product ? { id: p.product.id, name: p.product.name } : null,
      buyQty: p.buyQty,
      getQty: p.getQty,
      getProductId: p.getProductId,
      voucherCode: p.voucherCode,
      description: p.description,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
    }));
  }

  async calculateAutoPromo(
    companyId: string,
    body: CalculateAutoPromoDto,
  ): Promise<CalculateAutoPromoResponse> {
    const { items, subtotal } = body;
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: { notIn: ["VOUCHER", "BUNDLE"] },
      },
      include: {
        category: { select: { id: true } },
        product: { select: { id: true } },
      },
    });

    const appliedPromos: AppliedPromoResponse[] = [];
    let totalDiscount = 0;
    const productIdsForPrice = promotions
      .map((promo) => promo.getProductId)
      .filter((id): id is string => Boolean(id));
    const productPriceMap =
      productIdsForPrice.length > 0
        ? new Map(
            (
              await this.prisma.product.findMany({
                where: { id: { in: Array.from(new Set(productIdsForPrice)) } },
                select: { id: true, sellingPrice: true },
              })
            ).map((p) => [p.id, p.sellingPrice]),
          )
        : new Map<string, number>();

    const findQualifiedItems = (promo: {
      productId: string | null;
      categoryId: string | null;
    }) => {
      if (promo.productId)
        return items.filter((i) => i.productId === promo.productId);
      if (promo.categoryId)
        return items.filter((i) => i.categoryId === promo.categoryId);
      return items;
    };

    const capDiscount = (value: number, maxDiscount: number | null) => {
      if (!maxDiscount) return value;
      return value > maxDiscount ? maxDiscount : value;
    };

    for (const promo of promotions) {
      if (promo.minPurchase && subtotal < promo.minPurchase) continue;
      const qualifiedItems = findQualifiedItems(promo);
      if (qualifiedItems.length === 0) continue;

      if (promo.type === "DISCOUNT_PERCENT") {
        const baseAmount =
          promo.productId || promo.categoryId
            ? qualifiedItems.reduce((sum, item) => sum + item.subtotal, 0)
            : subtotal;
        const disc = capDiscount(
          Math.round(baseAmount * (promo.value / 100)),
          promo.maxDiscount,
        );
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "DISCOUNT_AMOUNT") {
        const disc = capDiscount(promo.value, promo.maxDiscount);
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "BUY_X_GET_Y") {
        const buyQty = promo.buyQty || 1;
        const getQty = promo.getQty || 1;
        const buyItem = promo.productId
          ? items.find((i) => i.productId === promo.productId)
          : qualifiedItems[0];
        if (buyItem && buyItem.quantity >= buyQty) {
          const multiplier = Math.floor(buyItem.quantity / buyQty);
          const freeItems = multiplier * getQty;
          const targetProductId = promo.getProductId || buyItem.productId;
          const targetItem = items.find(
            (i) => i.productId === targetProductId,
          );
          const freeUnitPrice =
            targetItem?.unitPrice ||
            productPriceMap.get(targetProductId) ||
            buyItem.unitPrice;
          const disc = capDiscount(
            freeItems * freeUnitPrice,
            promo.maxDiscount,
          );
          if (disc <= 0) continue;
          // Map promo ke BUY product (yang ADA di cart), bukan GET product
          // (yang mungkin belum ada di cart). Frontend butuh cart-line ID
          // untuk render badge promo per-line.
          appliedPromos.push({
            promoId: promo.id,
            promoName: promo.name,
            type: promo.type,
            discountAmount: disc,
            appliedTo: buyItem.productId,
          });
          totalDiscount += disc;
        }
      }
    }

    return { promos: appliedPromos, totalDiscount };
  }

  async validateVoucher(
    companyId: string,
    body: ValidateVoucherDto,
  ): Promise<ValidateVoucherResponse> {
    const { code, subtotal } = body;
    const now = new Date();
    const promo = await this.prisma.promotion.findFirst({
      where: {
        voucherCode: code.toUpperCase(),
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "VOUCHER",
      },
    });

    if (!promo) return { error: "Voucher tidak valid atau sudah expired" };
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      return { error: "Voucher sudah habis digunakan" };
    }
    if (promo.minPurchase && subtotal < promo.minPurchase) {
      return {
        error: `Minimum pembelian ${promo.minPurchase} untuk voucher ini`,
      };
    }

    let discount = promo.value;
    if (promo.maxDiscount && discount > promo.maxDiscount)
      discount = promo.maxDiscount;

    return {
      success: true,
      promoId: promo.id,
      promoName: promo.name,
      discount,
    };
  }

  async findCustomerByPhone(
    companyId: string,
    phone: string,
  ): Promise<FindCustomerByPhoneResponse> {
    if (!phone || phone.length < 4) return null;

    return this.prisma.customer.findFirst({
      where: {
        companyId,
        OR: [{ phone: { contains: phone } }, { memberCardCode: phone }],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        memberLevel: true,
        points: true,
        totalSpending: true,
        memberCardCode: true,
      },
    });
  }

  async getTebusMurahOptions(
    companyId: string,
    body: TebusMurahOptionsDto,
  ): Promise<TebusMurahOptionResponse[]> {
    const { items, subtotal, selections } = body;
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "BUNDLE",
        getProductId: { not: null },
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const productIds = promos
      .map((promo) => promo.getProductId)
      .filter((id): id is string => Boolean(id));
    const products = await this.prisma.product.findMany({
      where: { id: { in: Array.from(new Set(productIds)) } },
      select: {
        id: true,
        name: true,
        code: true,
        sellingPrice: true,
        stock: true,
        imageUrl: true,
        minStock: true,
      },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const selectedQtyMap = new Map(
      (selections ?? []).map((item) => [item.promoId, item.quantity]),
    );

    return promos
      .map((promo) => {
        const triggerQty = promo.productId
          ? items
              .filter((item) => item.productId === promo.productId)
              .reduce((sum, item) => sum + item.quantity, 0)
          : promo.categoryId
            ? items
                .filter((item) => item.categoryId === promo.categoryId)
                .reduce((sum, item) => sum + item.quantity, 0)
            : items.reduce((sum, item) => sum + item.quantity, 0);
        const buyQty = promo.buyQty || 1;
        const triggerMultiplier =
          promo.productId || promo.categoryId
            ? Math.floor(triggerQty / buyQty)
            : 1;
        const minPurchaseMultiplier = promo.minPurchase
          ? Math.floor(subtotal / promo.minPurchase)
          : Number.POSITIVE_INFINITY;
        const eligibleMultiplier = Math.min(
          triggerMultiplier || 0,
          minPurchaseMultiplier,
        );
        const tebusPerMultiplier = promo.getQty || 1;
        const rawMaxQty =
          eligibleMultiplier > 0 ? tebusPerMultiplier * eligibleMultiplier : 0;
        const maxQty = promo.maxDiscount
          ? Math.min(rawMaxQty, Math.floor(promo.maxDiscount))
          : rawMaxQty;
        const usedQty = selectedQtyMap.get(promo.id) || 0;
        const remainingQty = Math.max(0, maxQty - usedQty);
        const product = promo.getProductId
          ? productMap.get(promo.getProductId)
          : null;
        if (!product || remainingQty <= 0) return null;
        return {
          promoId: promo.id,
          promoName: promo.name,
          tebusPrice: promo.value,
          buyQty,
          tebusQty: tebusPerMultiplier,
          maxQty,
          usedQty,
          remainingQty,
          triggerLabel: promo.product
            ? `Beli ${buyQty} ${promo.product.name}`
            : promo.category
              ? `Beli ${buyQty} produk kategori ${promo.category.name}`
              : promo.minPurchase
                ? `Belanja minimal ${promo.minPurchase}`
                : "Belanja produk promo",
          product: {
            id: product.id,
            name: product.name,
            code: product.code,
            sellingPrice: product.sellingPrice,
            stock: product.stock,
            minStock: product.minStock,
            imageUrl: product.imageUrl,
          },
        } satisfies TebusMurahOptionResponse;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
}
