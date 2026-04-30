import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { buildSalesViewWhere } from "./reports.helpers";

@Injectable()
export class ViewReportsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const params: unknown[] = [start, end];
    const branchCond = branchId
      ? `AND "branchId" = $${params.push(branchId)}`
      : "";
    const companyCond = `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ h: number; total: bigint; count: bigint }>
    >(
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
    const { where, params } = buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        categoryId: string;
        categoryName: string;
        totalQuantity: number;
        totalRevenue: number;
        totalCost: number;
        transactionCount: number;
      }>
    >(
      `SELECT COALESCE(v.category_id, 'no-cat') AS "categoryId",
              COALESCE(v.category_name, 'Tanpa Kategori') AS "categoryName",
              SUM(v.quantity)::int AS "totalQuantity",
              COALESCE(SUM(v.subtotal), 0)::float AS "totalRevenue",
              COALESCE(SUM(v.quantity * v.purchase_price), 0)::float AS "totalCost",
              COUNT(DISTINCT v.transaction_id)::int AS "transactionCount"
         FROM public.vw_sales_item_facts v
         WHERE ${where}
         GROUP BY v.category_id, v.category_name
         ORDER BY "totalRevenue" DESC`,
      ...params,
    );
    const topRows = await this.prisma.$queryRawUnsafe<
      Array<{
        categoryId: string;
        productName: string;
        quantity: number;
        revenue: number;
        rn: number;
      }>
    >(
      `SELECT * FROM (
         SELECT COALESCE(v.category_id, 'no-cat') AS "categoryId",
                v.product_name AS "productName",
                SUM(v.quantity)::int AS quantity,
                COALESCE(SUM(v.subtotal), 0)::float AS revenue,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(v.category_id, 'no-cat') ORDER BY SUM(v.subtotal) DESC) AS rn
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v.category_id, v.product_id, v.product_name
       ) ranked WHERE rn <= 5`,
      ...params,
    );
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
    const { where, params } = buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [rows, topRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          supplierId: string | null;
          supplierName: string;
          totalQuantity: number;
          totalRevenue: number;
          totalCost: number;
          productCount: number;
        }>
      >(
        `SELECT v.supplier_id AS "supplierId",
                COALESCE(v.supplier_name, 'Tanpa Supplier') AS "supplierName",
                SUM(v.quantity)::int AS "totalQuantity",
                COALESCE(SUM(v.subtotal), 0)::float AS "totalRevenue",
                COALESCE(SUM(v.quantity * v.purchase_price), 0)::float AS "totalCost",
                COUNT(DISTINCT v.product_id)::int AS "productCount"
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v.supplier_id, v.supplier_name
           ORDER BY "totalRevenue" DESC`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          supplierId: string | null;
          productName: string;
          quantity: number;
          revenue: number;
        }>
      >(
        `SELECT * FROM (
           SELECT v.supplier_id AS "supplierId",
                  v.product_name AS "productName",
                  SUM(v.quantity)::int AS quantity,
                  COALESCE(SUM(v.subtotal), 0)::float AS revenue,
                  ROW_NUMBER() OVER (PARTITION BY v.supplier_id ORDER BY SUM(v.subtotal) DESC) AS rn
             FROM public.vw_sales_item_facts v
             WHERE ${where}
             GROUP BY v.supplier_id, v.product_id, v.product_name
         ) ranked WHERE rn <= 5`,
        ...params,
      ),
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
    const { where, params } = buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [totals, topCashiers, categoryRows, itemCount] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          revenue: number;
          discount: number;
          tax: number;
          txCount: number;
        }>
      >(
        `SELECT COALESCE(SUM(v.grand_total), 0)::float AS revenue,
                COALESCE(SUM(v.discount_amount), 0)::float AS discount,
                COALESCE(SUM(v.tax_amount), 0)::float AS tax,
                COUNT(v.transaction_id)::int AS "txCount"
           FROM public.vw_sales_transactions_fact v
           WHERE ${where}`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          userId: string;
          name: string;
          transactions: number;
          revenue: number;
        }>
      >(
        `SELECT v.user_id AS "userId",
                COALESCE(v.cashier_name, 'Unknown') AS name,
                COUNT(v.transaction_id)::int AS transactions,
                COALESCE(SUM(v.grand_total), 0)::float AS revenue
           FROM public.vw_sales_transactions_fact v
           WHERE ${where}
           GROUP BY v.user_id, v.cashier_name
           ORDER BY revenue DESC
           LIMIT 5`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{ category: string; total: number; quantity: number }>
      >(
        `SELECT COALESCE(v.category_name, 'Tanpa Kategori') AS category,
                COALESCE(SUM(v.subtotal), 0)::float AS total,
                SUM(v.quantity)::int AS quantity
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v.category_name
           ORDER BY total DESC
           LIMIT 8`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COALESCE(SUM(v.quantity), 0)::int AS total
           FROM public.vw_sales_item_facts v
           WHERE ${where}`,
        ...params,
      ),
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
    const { where, params } = buildSalesViewWhere(
      dateFrom,
      dateTo,
      branchId,
      "v",
      companyId,
    );
    const [txRows, itemRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          userId: string;
          name: string;
          email: string;
          role: string;
          totalRevenue: number;
          totalDiscount: number;
          transactionCount: number;
        }>
      >(
        `SELECT v.user_id AS "userId",
                COALESCE(v.cashier_name, 'Unknown') AS name,
                COALESCE(v.cashier_email, '-') AS email,
                COALESCE(v.cashier_role, '-') AS role,
                COALESCE(SUM(v.grand_total), 0)::float AS "totalRevenue",
                COALESCE(SUM(v.discount_amount), 0)::float AS "totalDiscount",
                COUNT(v.transaction_id)::int AS "transactionCount"
           FROM public.vw_sales_transactions_fact v
           WHERE ${where}
           GROUP BY v.user_id, v.cashier_name, v.cashier_email, v.cashier_role`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{ userId: string; totalCost: number; itemsSold: number }>
      >(
        `SELECT v.user_id AS "userId",
                COALESCE(SUM(v.quantity * v.purchase_price), 0)::float AS "totalCost",
                SUM(v.quantity)::int AS "itemsSold"
           FROM public.vw_sales_item_facts v
           WHERE ${where}
           GROUP BY v.user_id`,
        ...params,
      ),
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
}
