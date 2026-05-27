import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

export type RawProfitMetrics = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  discount: number;
  tax: number;
  expense: number;
  netProfit: number;
  transactionCount: number;
  itemsSold: number;
};

export type RawCategoryProfit = {
  category: string;
  revenue: number;
  cost: number;
  units: number;
};

export type RawProductProfit = {
  productName: string;
  productCode: string;
  unitsSold: number;
  revenue: number;
  cost: number;
};

export type RawBranchRevenue = {
  branchId: string;
  branchName: string;
  revenue: number;
  cost: number;
};

export type RawBranchExpense = {
  branchId: string;
  total: number;
};

export type RawTrendRow = {
  d: Date;
  revenue: number;
  cost: number;
};

export type RawMarginRow = {
  productName: string;
  revenue: number;
  cost: number;
};

@Injectable()
export class ProfitDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProfitMetrics(
    periodStart: Date,
    periodEnd: Date,
    branchId: string | null,
    companyId: string | null,
  ): Promise<RawProfitMetrics | undefined> {
    const rows = await this.prisma.$queryRawUnsafe<RawProfitMetrics[]>(
      `SELECT * FROM fn_get_profit_metrics($1, $2, $3, $4)`,
      periodStart,
      periodEnd,
      branchId,
      companyId,
    );
    return rows[0];
  }

  async findByCategory(
    periodStart: Date,
    periodEnd: Date,
    branchId: string | undefined,
    companyId: string | null,
  ): Promise<RawCategoryProfit[]> {
    const bc = this.branchClause(branchId, "t", 3);
    const params: unknown[] = [periodStart, periodEnd, ...bc.params];
    let companyCondition = "";
    if (companyId) {
      params.push(companyId);
      companyCondition = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.length})`;
    }

    return this.prisma.$queryRawUnsafe<RawCategoryProfit[]>(
      `
      SELECT
        COALESCE(c."name", 'Lainnya') AS category,
        COALESCE(SUM(ti."subtotal"), 0)::float AS revenue,
        COALESCE(SUM(ti."quantity" * p."purchasePrice"), 0)::float AS cost,
        COALESCE(SUM(ti."quantity"), 0)::int AS units
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      LEFT JOIN categories c ON c."id" = p."categoryId"
      WHERE t."status" = 'COMPLETED'
        AND t."createdAt" >= $1
        AND t."createdAt" < $2
        ${bc.condition}
        ${companyCondition}
      GROUP BY c."name"
      ORDER BY SUM(ti."subtotal") DESC
      `,
      ...params,
    );
  }

  async findByProduct(
    periodStart: Date,
    periodEnd: Date,
    branchId: string | undefined,
    companyId: string | null,
    limit: number,
    sortDir: "ASC" | "DESC",
  ): Promise<RawProductProfit[]> {
    const params: unknown[] = [periodStart, periodEnd];
    let branchCondition = "";
    if (branchId) {
      params.push(branchId);
      branchCondition = `AND t."branchId" = $${params.length}`;
    }
    let companyCondition = "";
    if (companyId) {
      params.push(companyId);
      companyCondition = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.length})`;
    }
    params.push(limit);
    const limitIdx = params.length;

    return this.prisma.$queryRawUnsafe<RawProductProfit[]>(
      `
      SELECT
        ti."productName" AS "productName",
        ti."productCode" AS "productCode",
        SUM(ti."quantity")::int AS "unitsSold",
        SUM(ti."subtotal")::float AS revenue,
        SUM(ti."quantity" * p."purchasePrice")::float AS cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      WHERE t."status" = 'COMPLETED'
        AND t."createdAt" >= $1
        AND t."createdAt" < $2
        ${branchCondition}
        ${companyCondition}
      GROUP BY ti."productName", ti."productCode"
      ORDER BY (SUM(ti."subtotal") - SUM(ti."quantity" * p."purchasePrice")) ${sortDir}
      LIMIT $${limitIdx}
      `,
      ...params,
    );
  }

  async findBranchRevenue(
    periodStart: Date,
    periodEnd: Date,
    companyId: string | null,
  ): Promise<RawBranchRevenue[]> {
    const params: unknown[] = [periodStart, periodEnd];
    const companyCond = companyId
      ? `AND b."companyId" = $${params.push(companyId)}`
      : "";

    return this.prisma.$queryRawUnsafe<RawBranchRevenue[]>(
      `
      SELECT
        b."id" AS "branchId",
        b."name" AS "branchName",
        COALESCE(SUM(ti."subtotal"), 0)::float AS revenue,
        COALESCE(SUM(ti."quantity" * p."purchasePrice"), 0)::float AS cost
      FROM branches b
      LEFT JOIN transactions t ON t."branchId" = b."id"
        AND t."status" = 'COMPLETED'
        AND t."createdAt" >= $1
        AND t."createdAt" < $2
      LEFT JOIN transaction_items ti ON ti."transactionId" = t."id"
      LEFT JOIN products p ON p."id" = ti."productId"
      WHERE b."isActive" = true
        ${companyCond}
      GROUP BY b."id", b."name"
      ORDER BY SUM(ti."subtotal") DESC NULLS LAST
      `,
      ...params,
    );
  }

  async findBranchExpenses(
    periodStart: Date,
    periodEnd: Date,
    companyId: string | null,
  ): Promise<RawBranchExpense[]> {
    const params: unknown[] = [periodStart, periodEnd];
    const companyCond = companyId
      ? `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.push(companyId)})`
      : "";

    return this.prisma.$queryRawUnsafe<RawBranchExpense[]>(
      `
      SELECT "branchId" AS "branchId", COALESCE(SUM("amount"), 0)::float AS total
      FROM expenses
      WHERE "date" >= $1 AND "date" < $2 AND "branchId" IS NOT NULL
        ${companyCond}
      GROUP BY "branchId"
      `,
      ...params,
    );
  }

  async findTrend(
    startDate: Date,
    branchId: string | undefined,
    companyId: string | null,
  ): Promise<RawTrendRow[]> {
    const bc = this.branchClause(branchId, "t", 2);
    const params: unknown[] = [startDate, ...bc.params];
    let companyCond = "";
    if (companyId) {
      params.push(companyId);
      companyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.length})`;
    }

    return this.prisma.$queryRawUnsafe<RawTrendRow[]>(
      `
      SELECT
        DATE_TRUNC('day', t."createdAt") AS d,
        COALESCE(SUM(ti."subtotal"), 0)::float AS revenue,
        COALESCE(SUM(ti."quantity" * p."purchasePrice"), 0)::float AS cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      WHERE t."status" = 'COMPLETED'
        AND t."createdAt" >= $1
        ${bc.condition}
        ${companyCond}
      GROUP BY DATE_TRUNC('day', t."createdAt")
      ORDER BY d ASC
      `,
      ...params,
    );
  }

  async findMarginDistribution(
    branchId: string | undefined,
    companyId: string | null,
  ): Promise<RawMarginRow[]> {
    const bc = this.branchClause(branchId, "t", 1);
    const params: unknown[] = [...bc.params];
    let companyCond = "";
    if (companyId) {
      params.push(companyId);
      companyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.length})`;
    }

    return this.prisma.$queryRawUnsafe<RawMarginRow[]>(
      `
      SELECT
        ti."productName" AS "productName",
        SUM(ti."subtotal")::float AS revenue,
        SUM(ti."quantity" * p."purchasePrice")::float AS cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      WHERE t."status" = 'COMPLETED'
        ${bc.condition}
        ${companyCond}
      GROUP BY ti."productName"
      HAVING SUM(ti."subtotal") > 0
      `,
      ...params,
    );
  }

  private branchClause(
    branchId: string | undefined,
    alias: string | undefined,
    paramIndex: number,
  ): { condition: string; params: unknown[] } {
    if (!branchId) return { condition: "", params: [] };
    const col = alias ? `${alias}."branchId"` : `"branchId"`;
    return {
      condition: `AND ${col} = $${paramIndex}`,
      params: [branchId],
    };
  }
}
