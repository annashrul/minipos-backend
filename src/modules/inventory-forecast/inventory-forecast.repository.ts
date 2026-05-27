import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const FORECAST_PRODUCT_INCLUDE = {
  category: { select: { name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

export type RawForecastProduct = Prisma.ProductGetPayload<{
  include: typeof FORECAST_PRODUCT_INCLUDE;
}>;

export type SalesAggregateRow = {
  productId: string;
  total_sold: bigint;
  active_days: bigint;
};

export type SalesTotalRow = {
  productId: string;
  total_sold: bigint;
};

export type DailySalesRow = {
  sale_date: Date;
  daily_qty: bigint;
};

@Injectable()
export class InventoryForecastRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 30-day sales aggregate: total sold + active selling days per product.
   */
  async getSalesAggregate(
    since: Date,
    branchId?: string,
  ): Promise<SalesAggregateRow[]> {
    const params: unknown[] = [since];
    let branchCondition = "";
    if (branchId) {
      params.push(branchId);
      branchCondition = `AND t."branchId" = $${params.length}`;
    }

    return this.prisma.$queryRawUnsafe<SalesAggregateRow[]>(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold,
               COUNT(DISTINCT DATE_TRUNC('day', t."createdAt")) as active_days
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          ${branchCondition}
        GROUP BY ti."productId"
      `,
      ...params,
    );
  }

  /**
   * Sales totals for a period starting from `since`.
   */
  async getSalesTotals(
    since: Date,
    branchId?: string,
  ): Promise<SalesTotalRow[]> {
    const params: unknown[] = [since];
    let branchCondition = "";
    if (branchId) {
      params.push(branchId);
      branchCondition = `AND t."branchId" = $${params.length}`;
    }

    return this.prisma.$queryRawUnsafe<SalesTotalRow[]>(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          ${branchCondition}
        GROUP BY ti."productId"
      `,
      ...params,
    );
  }

  /**
   * Sales totals for a date range [since, until).
   */
  async getSalesTotalsRange(
    since: Date,
    until: Date,
    branchId?: string,
  ): Promise<SalesTotalRow[]> {
    const params: unknown[] = [since, until];
    let branchCondition = "";
    if (branchId) {
      params.push(branchId);
      branchCondition = `AND t."branchId" = $${params.length}`;
    }

    return this.prisma.$queryRawUnsafe<SalesTotalRow[]>(
      `
        SELECT ti."productId",
               SUM(ti.quantity) as total_sold
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND t."createdAt" >= $1
          AND t."createdAt" < $2
          ${branchCondition}
        GROUP BY ti."productId"
      `,
      ...params,
    );
  }

  /**
   * Daily sales trend for a specific product.
   */
  async getDailySalesTrend(
    productId: string,
    since: Date,
    branchId?: string,
  ): Promise<DailySalesRow[]> {
    const params: unknown[] = [productId, since];
    let branchCondition = "";
    if (branchId) {
      params.push(branchId);
      branchCondition = `AND t."branchId" = $${params.length}`;
    }

    return this.prisma.$queryRawUnsafe<DailySalesRow[]>(
      `
        SELECT DATE_TRUNC('day', t."createdAt") as sale_date,
               SUM(ti.quantity) as daily_qty
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti."transactionId"
        WHERE t.status = 'COMPLETED'
          AND ti."productId" = $1
          AND t."createdAt" >= $2
          ${branchCondition}
        GROUP BY DATE_TRUNC('day', t."createdAt")
        ORDER BY sale_date ASC
      `,
      ...params,
    );
  }

  /**
   * Find products matching forecast filters.
   */
  async findProducts(
    where: Prisma.ProductWhereInput,
  ): Promise<RawForecastProduct[]> {
    return this.prisma.product.findMany({
      where,
      include: FORECAST_PRODUCT_INCLUDE,
    });
  }

  /**
   * Find suppliers by IDs within a company.
   */
  async findSuppliers(
    companyId: string,
    supplierIds: string[],
  ): Promise<{ id: string; name: string; contact: string | null; email: string | null }[]> {
    if (supplierIds.length === 0) return [];
    return this.prisma.supplier.findMany({
      where: { id: { in: supplierIds }, companyId },
      select: { id: true, name: true, contact: true, email: true },
    });
  }
}
