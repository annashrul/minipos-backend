import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── Raw SQL row types ────────────────────────────────────────────────

export type RawHourlySalesRow = {
  h: number;
  total: bigint;
  count: bigint;
};

export type RawCategorySalesRow = {
  categoryId: string;
  categoryName: string;
  totalQuantity: number;
  totalRevenue: number;
  totalCost: number;
  transactionCount: number;
};

export type RawCategoryTopProductRow = {
  categoryId: string;
  productName: string;
  quantity: number;
  revenue: number;
  rn: number;
};

export type RawSupplierSalesRow = {
  supplierId: string | null;
  supplierName: string;
  totalQuantity: number;
  totalRevenue: number;
  totalCost: number;
  productCount: number;
};

export type RawSupplierTopProductRow = {
  supplierId: string | null;
  productName: string;
  quantity: number;
  revenue: number;
};

export type RawOverviewTotalsRow = {
  revenue: number;
  discount: number;
  tax: number;
  txCount: number;
};

export type RawOverviewTopCashierRow = {
  userId: string;
  name: string;
  transactions: number;
  revenue: number;
};

export type RawOverviewCategoryRow = {
  category: string;
  total: number;
  quantity: number;
};

export type RawOverviewItemCountRow = {
  total: number;
};

export type RawCashierTxRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  totalRevenue: number;
  totalDiscount: number;
  transactionCount: number;
};

export type RawCashierItemRow = {
  userId: string;
  totalCost: number;
  itemsSold: number;
};

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Hourly sales ─────────────────────────────────────────────────

  async findHourlySales(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawHourlySalesRow[]> {
    const params: unknown[] = [start, end];
    const branchCond = branchId
      ? `AND "branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    return this.prisma.$queryRawUnsafe<RawHourlySalesRow[]>(
      `SELECT EXTRACT(HOUR FROM "createdAt")::int AS h,
              COALESCE(SUM("grandTotal"), 0) AS total,
              COUNT(*)::bigint AS count
         FROM transactions
         WHERE status = 'COMPLETED'
           AND "createdAt" >= $1 AND "createdAt" <= $2
           ${branchCond}
           ${companyCond}
         GROUP BY EXTRACT(HOUR FROM "createdAt")
         ORDER BY h`,
      ...params,
    );
  }

  // ── Category sales ───────────────────────────────────────────────

  async findCategorySales(
    where: string,
    params: unknown[],
  ): Promise<RawCategorySalesRow[]> {
    return this.prisma.$queryRawUnsafe<RawCategorySalesRow[]>(
      `SELECT COALESCE(v."categoryId", 'no-cat') AS "categoryId",
              COALESCE(v."categoryName", 'Tanpa Kategori') AS "categoryName",
              SUM(v.quantity)::int AS "totalQuantity",
              COALESCE(SUM(v.subtotal), 0)::float AS "totalRevenue",
              COALESCE(SUM(v.quantity * v."purchasePrice"), 0)::float AS "totalCost",
              COUNT(DISTINCT v."transactionId")::int AS "transactionCount"
         FROM public.vw_sales_item_facts v
         WHERE ${where}
         GROUP BY v."categoryId", v."categoryName"
         ORDER BY "totalRevenue" DESC`,
      ...params,
    );
  }

  async findCategoryTopProducts(
    where: string,
    params: unknown[],
  ): Promise<RawCategoryTopProductRow[]> {
    return this.prisma.$queryRawUnsafe<RawCategoryTopProductRow[]>(
      `SELECT * FROM (
         SELECT COALESCE(v."categoryId", 'no-cat') AS "categoryId",
                v."productName" AS "productName",
                SUM(v.quantity)::int AS quantity,
                COALESCE(SUM(v.subtotal), 0)::float AS revenue,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(v."categoryId", 'no-cat') ORDER BY SUM(v.subtotal) DESC) AS rn
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v."categoryId", v."productId", v."productName"
       ) ranked WHERE rn <= 5`,
      ...params,
    );
  }

  // ── Supplier sales ───────────────────────────────────────────────

  async findSupplierSales(
    where: string,
    params: unknown[],
  ): Promise<RawSupplierSalesRow[]> {
    return this.prisma.$queryRawUnsafe<RawSupplierSalesRow[]>(
      `SELECT v."supplierId" AS "supplierId",
              COALESCE(v."supplierName", 'Tanpa Supplier') AS "supplierName",
              SUM(v.quantity)::int AS "totalQuantity",
              COALESCE(SUM(v.subtotal), 0)::float AS "totalRevenue",
              COALESCE(SUM(v.quantity * v."purchasePrice"), 0)::float AS "totalCost",
              COUNT(DISTINCT v."productId")::int AS "productCount"
         FROM public.vw_sales_item_facts v
         WHERE ${where}
         GROUP BY v."supplierId", v."supplierName"
         ORDER BY "totalRevenue" DESC`,
      ...params,
    );
  }

  async findSupplierTopProducts(
    where: string,
    params: unknown[],
  ): Promise<RawSupplierTopProductRow[]> {
    return this.prisma.$queryRawUnsafe<RawSupplierTopProductRow[]>(
      `SELECT * FROM (
         SELECT v."supplierId" AS "supplierId",
                v."productName" AS "productName",
                SUM(v.quantity)::int AS quantity,
                COALESCE(SUM(v.subtotal), 0)::float AS revenue,
                ROW_NUMBER() OVER (PARTITION BY v."supplierId" ORDER BY SUM(v.subtotal) DESC) AS rn
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v."supplierId", v."productId", v."productName"
       ) ranked WHERE rn <= 5`,
      ...params,
    );
  }

  // ── Overview ─────────────────────────────────────────────────────

  async findOverviewTotals(
    where: string,
    params: unknown[],
  ): Promise<RawOverviewTotalsRow[]> {
    return this.prisma.$queryRawUnsafe<RawOverviewTotalsRow[]>(
      `SELECT COALESCE(SUM(v."grandTotal"), 0)::float AS revenue,
              COALESCE(SUM(v."discountAmount"), 0)::float AS discount,
              COALESCE(SUM(v."taxAmount"), 0)::float AS tax,
              COUNT(v."transactionId")::int AS "txCount"
         FROM public.vw_sales_transactions_fact v
         WHERE ${where}`,
      ...params,
    );
  }

  async findOverviewTopCashiers(
    where: string,
    params: unknown[],
  ): Promise<RawOverviewTopCashierRow[]> {
    return this.prisma.$queryRawUnsafe<RawOverviewTopCashierRow[]>(
      `SELECT v."userId" AS "userId",
              COALESCE(v."cashierName", 'Unknown') AS name,
              COUNT(v."transactionId")::int AS transactions,
              COALESCE(SUM(v."grandTotal"), 0)::float AS revenue
         FROM public.vw_sales_transactions_fact v
         WHERE ${where}
         GROUP BY v."userId", v."cashierName"
         ORDER BY revenue DESC
         LIMIT 5`,
      ...params,
    );
  }

  async findOverviewCategorySales(
    where: string,
    params: unknown[],
  ): Promise<RawOverviewCategoryRow[]> {
    return this.prisma.$queryRawUnsafe<RawOverviewCategoryRow[]>(
      `SELECT COALESCE(v."categoryName", 'Tanpa Kategori') AS category,
              COALESCE(SUM(v.subtotal), 0)::float AS total,
              SUM(v.quantity)::int AS quantity
         FROM public.vw_sales_item_facts v
         WHERE ${where}
         GROUP BY v."categoryName"
         ORDER BY total DESC
         LIMIT 8`,
      ...params,
    );
  }

  async findOverviewItemCount(
    where: string,
    params: unknown[],
  ): Promise<RawOverviewItemCountRow[]> {
    return this.prisma.$queryRawUnsafe<RawOverviewItemCountRow[]>(
      `SELECT COALESCE(SUM(v.quantity), 0)::int AS total
         FROM public.vw_sales_item_facts v
         WHERE ${where}`,
      ...params,
    );
  }

  // ── Cashier sales ────────────────────────────────────────────────

  async findCashierTransactions(
    where: string,
    params: unknown[],
  ): Promise<RawCashierTxRow[]> {
    return this.prisma.$queryRawUnsafe<RawCashierTxRow[]>(
      `SELECT v."userId" AS "userId",
              COALESCE(v."cashierName", 'Unknown') AS name,
              COALESCE(v."cashierEmail", '-') AS email,
              COALESCE(v."cashierRole", '-') AS role,
              COALESCE(SUM(v."grandTotal"), 0)::float AS "totalRevenue",
              COALESCE(SUM(v."discountAmount"), 0)::float AS "totalDiscount",
              COUNT(v."transactionId")::int AS "transactionCount"
         FROM public.vw_sales_transactions_fact v
         WHERE ${where}
         GROUP BY v."userId", v."cashierName", v."cashierEmail", v."cashierRole"`,
      ...params,
    );
  }

  async findCashierItems(
    where: string,
    params: unknown[],
  ): Promise<RawCashierItemRow[]> {
    return this.prisma.$queryRawUnsafe<RawCashierItemRow[]>(
      `SELECT v."userId" AS "userId",
              COALESCE(SUM(v.quantity * v."purchasePrice"), 0)::float AS "totalCost",
              SUM(v.quantity)::int AS "itemsSold"
         FROM public.vw_sales_item_facts v
         WHERE ${where}
         GROUP BY v."userId"`,
      ...params,
    );
  }
}
