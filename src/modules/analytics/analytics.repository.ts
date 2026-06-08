import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── Raw SQL row types ────────────────────────────────────────────────

export type RawSlowMovingRow = {
  productId: string;
  soldQty: number;
};

export type RawPeakHourRow = {
  h: number;
  count: bigint;
  revenue: bigint;
};

export type RawVoidAbuseRow = {
  name: string;
  role: string;
  voidCount: number;
};

export type RawUnusualDiscountRow = {
  invoiceNumber: string;
  invoiceDisplayNumber: string | null;
  cashierName: string;
  role: string;
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  createdAt: string;
};

export type RawDailyProfitRow = {
  d: Date;
  revenue: bigint;
  cost: bigint;
};

export type RawShiftRevenueRow = {
  shiftId: string;
  revenue: number;
  txCount: number;
};

export type RawPromoTxAggRow = {
  promoApplied: string;
  usageCount: number;
  totalDiscount: number;
};

export type RawReorderAlertRow = {
  id: string;
  name: string;
  code: string;
  stock: number;
  minStock: number;
  supplierName: string | null;
};

export type RawLowStockProductRow = {
  id: string;
  name: string;
  code: string;
  stock: number;
  minStock: number;
  supplierName: string | null;
};

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Margin analyzers ─────────────────────────────────────────────

  findActiveProductsWithCategory(companyId: string) {
    return this.prisma.product.findMany({
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
  }

  findCategoriesWithProducts(companyId: string) {
    return this.prisma.category.findMany({
      where: { companyId },
      include: {
        products: {
          where: { isActive: true },
          select: { purchasePrice: true, sellingPrice: true, stock: true },
        },
      },
    });
  }

  // ── Dead stock ───────────────────────────────────────────────────

  findActiveProductsWithStock(companyId: string) {
    return this.prisma.product.findMany({
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
  }

  findRecentSoldProductIds(companyId: string, since: Date) {
    return this.prisma.transactionItem.findMany({
      where: {
        createdAt: { gte: since },
        transaction: { branch: { companyId } },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
  }

  // ── Slow-moving ──────────────────────────────────────────────────

  findSlowMovingProducts(
    since: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawSlowMovingRow[]> {
    const params: unknown[] = [since];
    const branchCond = branchId
      ? `AND t."branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    return this.prisma.$queryRawUnsafe<RawSlowMovingRow[]>(
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
  }

  findProductsByIds(ids: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        category: { select: { name: true } },
      },
    });
  }

  // ── Peak hours ───────────────────────────────────────────────────

  findPeakHours(
    since: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawPeakHourRow[]> {
    const params: unknown[] = [since];
    const branchCond = branchId
      ? `AND "branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    return this.prisma.$queryRawUnsafe<RawPeakHourRow[]>(
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
  }

  // ── Reorder ──────────────────────────────────────────────────────

  findReorderAlerts(companyId: string): Promise<RawReorderAlertRow[]> {
    return this.prisma.$queryRawUnsafe<RawReorderAlertRow[]>(
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

  findLowStockProducts(companyId: string): Promise<RawLowStockProductRow[]> {
    return this.prisma.$queryRawUnsafe<RawLowStockProductRow[]>(
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
  }

  findSalesAggByProductIds(productIds: string[], since: Date) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        createdAt: { gte: since },
        transaction: { status: "COMPLETED" },
      },
      _sum: { quantity: true },
    });
  }

  // ── Fraud detection ──────────────────────────────────────────────

  findVoidAbuse(
    since: Date,
    companyId: string,
  ): Promise<RawVoidAbuseRow[]> {
    return this.prisma.$queryRawUnsafe<RawVoidAbuseRow[]>(
      `
      SELECT u.name, u.role, COUNT(t.id)::int AS "voidCount"
      FROM transactions t
      JOIN users u ON u.id = t."userId"
      WHERE t.status = 'VOIDED' AND t."createdAt" >= $1
        AND u."companyId" = $2
      GROUP BY u.id, u.name, u.role
      ORDER BY "voidCount" DESC
      `,
      since,
      companyId,
    );
  }

  findUnusualDiscounts(
    since: Date,
    companyId: string,
  ): Promise<RawUnusualDiscountRow[]> {
    return this.prisma.$queryRawUnsafe<RawUnusualDiscountRow[]>(
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
      since,
      companyId,
    );
  }

  // ── Profit ───────────────────────────────────────────────────────

  findDailyProfit(
    since: Date,
    companyId: string,
  ): Promise<RawDailyProfitRow[]> {
    return this.prisma.$queryRawUnsafe<RawDailyProfitRow[]>(
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
      since,
      companyId,
    );
  }

  findClosedShifts(companyId: string) {
    return this.prisma.cashierShift.findMany({
      where: { isOpen: false, closedAt: { not: null }, branch: { companyId } },
      include: { user: { select: { name: true } } },
      orderBy: { closedAt: "desc" },
      take: 30,
    });
  }

  findShiftRevenues(shiftIds: string[]): Promise<RawShiftRevenueRow[]> {
    return this.prisma.$queryRawUnsafe<RawShiftRevenueRow[]>(
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
      shiftIds,
    );
  }

  // ── Suppliers ────────────────────────────────────────────────────

  findSupplierRanking(companyId: string) {
    return this.prisma.$queryRawUnsafe(
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

  findSupplierDebt(companyId: string) {
    return this.prisma.$queryRawUnsafe(
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

  // ── Promo effectiveness ──────────────────────────────────────────

  findPromotions(companyId: string) {
    return this.prisma.promotion.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  findPromoTxAgg(): Promise<RawPromoTxAggRow[]> {
    return this.prisma.$queryRaw<RawPromoTxAggRow[]>`
      SELECT "promoApplied",
             COUNT(*)::int AS "usageCount",
             COALESCE(SUM("discountAmount"), 0)::float AS "totalDiscount"
      FROM transactions
      WHERE status = 'COMPLETED' AND "promoApplied" IS NOT NULL
      GROUP BY "promoApplied"
    `;
  }

  // ── Cashier performance ──────────────────────────────────────────

  findCashierPerformance(
    since: Date,
    companyId: string,
  ) {
    return this.prisma.$queryRawUnsafe(
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
      since,
      companyId,
    );
  }

  // ── Customer intelligence ────────────────────────────────────────

  findRepeatCustomers(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId },
      include: {
        _count: { select: { transactions: true } },
      },
      orderBy: { totalSpending: "desc" },
      take: 20,
    });
  }

  findCustomerFavorites(customerId: string) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId", "productName"],
      where: {
        transaction: { customerId },
      },
      _sum: { quantity: true, subtotal: true },
      _count: true,
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });
  }

  findShoppingFrequencyCustomers(companyId: string, since: Date) {
    return this.prisma.customer.findMany({
      where: {
        companyId,
        transactions: { some: { createdAt: { gte: since } } },
      },
      include: {
        transactions: {
          where: { createdAt: { gte: since }, status: "COMPLETED" },
          select: { createdAt: true, grandTotal: true },
          orderBy: { createdAt: "desc" },
        },
      },
      take: 20,
    });
  }

  findLoyaltySummary(companyId: string) {
    return this.prisma.customer.groupBy({
      by: ["memberLevel"],
      where: { companyId },
      _count: true,
      _sum: { totalSpending: true, points: true },
    });
  }

  // ── Promo engine ─────────────────────────────────────────────────

  findActivePromotions(companyId: string, now: Date) {
    return this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true } },
      },
    });
  }

  findAutoPromotions(companyId: string, now: Date) {
    return this.prisma.promotion.findMany({
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
  }

  findProductsByIdsWithPrice(ids: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, code: true, sellingPrice: true },
    });
  }

  findVoucher(companyId: string, code: string, now: Date) {
    return this.prisma.promotion.findFirst({
      where: {
        voucherCode: code.toUpperCase(),
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "VOUCHER",
      },
    });
  }

  findCustomerByPhone(companyId: string, phone: string) {
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

  findBundlePromotions(companyId: string, now: Date) {
    return this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "BUNDLE",
        OR: [
          { getProductId: { not: null } },
          { getProducts: { some: {} } },
        ],
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        triggerProducts: {
          include: { product: { select: { id: true, name: true } } },
        },
        getProducts: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  findProductsForTebusMurah(ids: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids } },
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
  }
}
