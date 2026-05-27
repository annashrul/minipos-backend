import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── Raw SQL row types ────────────────────────────────────────────────

export type RawDailySalesRow = {
  d: Date;
  total: bigint;
  count: bigint;
};

export type RawYearlyComparisonRow = {
  y: number;
  m: number;
  total: bigint;
  count: bigint;
};

export type RawTopCashierRow = {
  name: string;
  total: number;
  count: number;
};

export type RawCategoryBreakdownRow = {
  name: string;
  total: number;
  qty: number;
};

export type RawHourlySalesRow = {
  h: number;
  total: bigint;
  count: bigint;
};

export type RawProfitRow = {
  profit: number;
};

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Daily sales ──────────────────────────────────────────────────

  async findDailySales(
    startDate: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<RawDailySalesRow[]> {
    const params: unknown[] = [startDate];
    const branchCondition = this.buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );

    return this.prisma.$queryRawUnsafe<RawDailySalesRow[]>(
      `
      SELECT DATE_TRUNC('day', "createdAt") as d,
             COALESCE(SUM("grandTotal"), 0) as total,
             COUNT(*)::bigint as count
      FROM transactions
      WHERE "createdAt" >= $1
        AND status = 'COMPLETED'
        ${branchCondition}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY d ASC
      `,
      ...params,
    );
  }

  // ── Yearly comparison ────────────────────────────────────────────

  async findYearlyComparison(
    startDate: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<RawYearlyComparisonRow[]> {
    const params: unknown[] = [startDate];
    const branchCondition = this.buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );

    return this.prisma.$queryRawUnsafe<RawYearlyComparisonRow[]>(
      `
      SELECT EXTRACT(YEAR FROM "createdAt")::int as y,
             EXTRACT(MONTH FROM "createdAt")::int as m,
             COALESCE(SUM("grandTotal"), 0) as total,
             COUNT(*)::bigint as count
      FROM transactions
      WHERE "createdAt" >= $1
        AND "status" = 'COMPLETED'
        ${branchCondition}
      GROUP BY EXTRACT(YEAR FROM "createdAt"), EXTRACT(MONTH FROM "createdAt")
      ORDER BY y, m
      `,
      ...params,
    );
  }

  // ── Top cashiers ─────────────────────────────────────────────────

  async findTopCashiers(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<RawTopCashierRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = this.buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
      "t",
    );

    return this.prisma.$queryRawUnsafe<RawTopCashierRow[]>(
      `
      SELECT
        u.name as name,
        COALESCE(SUM(t."grandTotal"), 0)::float as total,
        COUNT(*)::int as count
      FROM transactions t
      JOIN users u ON u.id = t."userId"
      WHERE t."createdAt" >= $1
        AND t."createdAt" < $2
        AND t.status = 'COMPLETED'
        ${branchCondition}
      GROUP BY u.id, u.name
      ORDER BY total DESC
      LIMIT 5
      `,
      ...params,
    );
  }

  // ── Category breakdown ───────────────────────────────────────────

  async findCategoryBreakdown(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<RawCategoryBreakdownRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = this.buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
      "t",
    );

    return this.prisma.$queryRawUnsafe<RawCategoryBreakdownRow[]>(
      `
      SELECT
        COALESCE(c.name, 'Lainnya') as name,
        COALESCE(SUM(ti.subtotal), 0)::float as total,
        COALESCE(SUM(ti.quantity), 0)::int as qty
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN products p ON p.id = ti."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE t."createdAt" >= $1
        AND t."createdAt" < $2
        AND t.status = 'COMPLETED'
        ${branchCondition}
      GROUP BY c.name
      ORDER BY total DESC
      `,
      ...params,
    );
  }

  // ── Hourly sales ─────────────────────────────────────────────────

  async findHourlySales(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
    timeZone: string,
  ): Promise<RawHourlySalesRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = this.buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );
    const safeTz = timeZone.replace(/'/g, "''");

    return this.prisma.$queryRawUnsafe<RawHourlySalesRow[]>(
      `
      SELECT EXTRACT(HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE '${safeTz}'))::int as h,
             COALESCE(SUM("grandTotal"), 0) as total,
             COUNT(*)::bigint as count
      FROM transactions
      WHERE "createdAt" >= $1
        AND "createdAt" < $2
        AND "status" = 'COMPLETED'
        ${branchCondition}
      GROUP BY EXTRACT(HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE '${safeTz}'))
      ORDER BY h
      `,
      ...params,
    );
  }

  // ── Profit ───────────────────────────────────────────────────────

  async findProfit(
    periodStart: Date,
    periodEnd: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<RawProfitRow[]> {
    const profitParams: unknown[] = [periodStart, periodEnd];
    let profitBranchCond = "";
    if (branchId) {
      profitParams.push(branchId);
      profitBranchCond = `AND t."branchId" = $${profitParams.length}`;
    } else if (companyBranchIds.length > 0) {
      profitBranchCond = `AND t."branchId" IN (${companyBranchIds
        .map((_, i) => `$${profitParams.length + i + 1}`)
        .join(",")})`;
      profitParams.push(...companyBranchIds);
    } else {
      profitBranchCond = "AND 1=0";
    }

    return this.prisma.$queryRawUnsafe<RawProfitRow[]>(
      `
      SELECT COALESCE(SUM((ti."unitPrice" - p."purchasePrice") * ti.quantity), 0)::float AS profit
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN products p ON p.id = ti."productId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1 AND t."createdAt" < $2
        ${profitBranchCond}
      `,
      ...profitParams,
    );
  }

  // ── Shared helper ────────────────────────────────────────────────

  private buildBranchCondition(
    params: unknown[],
    branchId?: string,
    companyBranchIds?: string[],
    tableAlias?: string,
  ): string {
    const col = tableAlias ? `${tableAlias}."branchId"` : `"branchId"`;
    if (branchId) {
      params.push(branchId);
      return `AND ${col} = $${params.length}`;
    }
    if (companyBranchIds && companyBranchIds.length > 0) {
      const placeholders = companyBranchIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(",");
      params.push(...companyBranchIds);
      return `AND ${col} IN (${placeholders})`;
    }
    return "AND 1=0";
  }
}
