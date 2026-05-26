import { Injectable } from "@nestjs/common";
import type {
  MarginDistributionEntry,
  ProfitByBranchEntry,
  ProfitByCategoryEntry,
  ProfitByProductEntry,
  ProfitOverviewResponse,
  ProfitPeriodDto,
  ProfitTrendEntry,
} from "./dto/profit-dashboard.dto";
import { PrismaService } from "../prisma/prisma.service";

type Period = ProfitPeriodDto;

type PeriodDates = {
  periodStart: Date;
  prevPeriodStart: Date;
  prevPeriodEnd: Date;
  periodEnd: Date;
};

@Injectable()
export class ProfitDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Internal helpers
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private getPeriodDates(period: Period): PeriodDates {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let periodStart: Date;
    let prevPeriodStart: Date;
    let prevPeriodEnd: Date;

    switch (period) {
      case "today":
        periodStart = today;
        prevPeriodStart = new Date(today);
        prevPeriodStart.setDate(prevPeriodStart.getDate() - 1);
        prevPeriodEnd = today;
        break;
      case "week":
        periodStart = new Date(today);
        periodStart.setDate(today.getDate() - 7);
        prevPeriodStart = new Date(periodStart);
        prevPeriodStart.setDate(prevPeriodStart.getDate() - 7);
        prevPeriodEnd = periodStart;
        break;
      case "year":
        periodStart = new Date(today.getFullYear(), 0, 1);
        prevPeriodStart = new Date(today.getFullYear() - 1, 0, 1);
        prevPeriodEnd = new Date(today.getFullYear(), 0, 1);
        break;
      default: // month
        periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
        prevPeriodStart = new Date(
          today.getFullYear(),
          today.getMonth() - 1,
          1,
        );
        prevPeriodEnd = periodStart;
        break;
    }

    return { periodStart, prevPeriodStart, prevPeriodEnd, periodEnd: tomorrow };
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Public API
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getOverview(
    companyId: string | null,
    period: Period,
    branchId?: string,
  ): Promise<ProfitOverviewResponse> {
    const { periodStart, prevPeriodStart, prevPeriodEnd, periodEnd } =
      this.getPeriodDates(period);

    type ProfitRow = {
      revenue: number;
      cogs: number;
      gross_profit: number;
      discount: number;
      tax: number;
      expense: number;
      net_profit: number;
      transaction_count: number;
      items_sold: number;
    };

    const [[current], [prev]] = await Promise.all([
      this.prisma.$queryRawUnsafe<ProfitRow[]>(
        `SELECT * FROM fn_get_profit_metrics($1, $2, $3, $4)`,
        periodStart,
        periodEnd,
        branchId || null,
        companyId,
      ),
      this.prisma.$queryRawUnsafe<ProfitRow[]>(
        `SELECT * FROM fn_get_profit_metrics($1, $2, $3, $4)`,
        prevPeriodStart,
        prevPeriodEnd,
        branchId || null,
        companyId,
      ),
    ]);

    const revenue = current?.revenue ?? 0;
    const cogs = current?.cogs ?? 0;
    const grossProfit = current?.gross_profit ?? 0;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const expenses = current?.expense ?? 0;
    const netProfit = current?.net_profit ?? 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    const prevRevenue = prev?.revenue ?? 0;
    const prevCogs = prev?.cogs ?? 0;
    const prevGrossProfit = prev?.gross_profit ?? 0;
    const prevExpensesTotal = prev?.expense ?? 0;
    const prevNetProfit = prev?.net_profit ?? 0;

    const revenueGrowth =
      prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
    const grossProfitGrowth =
      prevGrossProfit > 0
        ? ((grossProfit - prevGrossProfit) / prevGrossProfit) * 100
        : 0;
    const netProfitGrowth =
      prevNetProfit > 0
        ? ((netProfit - prevNetProfit) / prevNetProfit) * 100
        : 0;
    const cogsGrowth =
      prevCogs > 0 ? ((cogs - prevCogs) / prevCogs) * 100 : 0;
    const expensesGrowth =
      prevExpensesTotal > 0
        ? ((expenses - prevExpensesTotal) / prevExpensesTotal) * 100
        : 0;

    return {
      revenue,
      cogs,
      grossProfit,
      grossMargin: Math.round(grossMargin * 100) / 100,
      expenses,
      netProfit,
      netMargin: Math.round(netMargin * 100) / 100,
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
      grossProfitGrowth: Math.round(grossProfitGrowth * 10) / 10,
      netProfitGrowth: Math.round(netProfitGrowth * 10) / 10,
      cogsGrowth: Math.round(cogsGrowth * 10) / 10,
      expensesGrowth: Math.round(expensesGrowth * 10) / 10,
      transactionCount: Number(current?.transaction_count ?? 0),
    };
  }

  async getByCategory(
    companyId: string | null,
    period: Period,
    branchId?: string,
  ): Promise<ProfitByCategoryEntry[]> {
    const { periodStart, periodEnd } = this.getPeriodDates(period);
    const bc = this.branchClause(branchId, "t", 3);
    const params: unknown[] = [periodStart, periodEnd, ...bc.params];
    let companyCondition = "";
    if (companyId) {
      params.push(companyId);
      companyCondition = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${params.length})`;
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { category: string; revenue: number; cost: number; units: number }[]
    >(
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

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

    return rows.map((r) => ({
      category: r.category,
      revenue: r.revenue,
      cost: r.cost,
      profit: r.revenue - r.cost,
      margin:
        r.revenue > 0
          ? Math.round(((r.revenue - r.cost) / r.revenue) * 1000) / 10
          : 0,
      contribution:
        totalRevenue > 0
          ? Math.round((r.revenue / totalRevenue) * 1000) / 10
          : 0,
      units: r.units,
    }));
  }

  async getByProduct(
    companyId: string | null,
    period: Period,
    branchId?: string,
    limit: number = 10,
    order: "top" | "bottom" = "top",
  ): Promise<ProfitByProductEntry[]> {
    const { periodStart, periodEnd } = this.getPeriodDates(period);
    const sortDir = order === "top" ? "DESC" : "ASC";
    const prodParams: unknown[] = [periodStart, periodEnd];
    let prodBranchCondition = "";
    if (branchId) {
      prodParams.push(branchId);
      prodBranchCondition = `AND t."branchId" = $${prodParams.length}`;
    }
    let companyProdCondition = "";
    if (companyId) {
      prodParams.push(companyId);
      companyProdCondition = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${prodParams.length})`;
    }
    prodParams.push(limit);
    const limitIdx = prodParams.length;

    const rows = await this.prisma.$queryRawUnsafe<
      {
        product_name: string;
        product_code: string;
        units_sold: number;
        revenue: number;
        cost: number;
      }[]
    >(
      `
      SELECT
        ti."productName" AS product_name,
        ti."productCode" AS product_code,
        SUM(ti."quantity")::int AS units_sold,
        SUM(ti."subtotal")::float AS revenue,
        SUM(ti."quantity" * p."purchasePrice")::float AS cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      WHERE t."status" = 'COMPLETED'
        AND t."createdAt" >= $1
        AND t."createdAt" < $2
        ${prodBranchCondition}
        ${companyProdCondition}
      GROUP BY ti."productName", ti."productCode"
      ORDER BY (SUM(ti."subtotal") - SUM(ti."quantity" * p."purchasePrice")) ${sortDir}
      LIMIT $${limitIdx}
      `,
      ...prodParams,
    );

    return rows.map((r) => ({
      productName: r.product_name,
      productCode: r.product_code,
      unitsSold: r.units_sold,
      revenue: r.revenue,
      cost: r.cost,
      profit: r.revenue - r.cost,
      margin:
        r.revenue > 0
          ? Math.round(((r.revenue - r.cost) / r.revenue) * 1000) / 10
          : 0,
    }));
  }

  async getByBranch(
    companyId: string | null,
    period: Period,
  ): Promise<ProfitByBranchEntry[]> {
    const { periodStart, periodEnd } = this.getPeriodDates(period);
    const branchParams: unknown[] = [periodStart, periodEnd];
    const branchCompanyCond = companyId
      ? `AND b."companyId" = $${branchParams.push(companyId)}`
      : "";

    const rows = await this.prisma.$queryRawUnsafe<
      { branch_id: string; branch_name: string; revenue: number; cost: number }[]
    >(
      `
      SELECT
        b."id" AS branch_id,
        b."name" AS branch_name,
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
        ${branchCompanyCond}
      GROUP BY b."id", b."name"
      ORDER BY SUM(ti."subtotal") DESC NULLS LAST
      `,
      ...branchParams,
    );

    const expenseParams: unknown[] = [periodStart, periodEnd];
    const expenseCompanyCond = companyId
      ? `AND "branchId" IN (SELECT id FROM branches WHERE "companyId" = $${expenseParams.push(companyId)})`
      : "";
    const expenseRows = await this.prisma.$queryRawUnsafe<
      { branch_id: string; total: number }[]
    >(
      `
      SELECT "branchId" AS branch_id, COALESCE(SUM("amount"), 0)::float AS total
      FROM expenses
      WHERE "date" >= $1 AND "date" < $2 AND "branchId" IS NOT NULL
        ${expenseCompanyCond}
      GROUP BY "branchId"
      `,
      ...expenseParams,
    );

    const expenseMap = new Map(expenseRows.map((e) => [e.branch_id, e.total]));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

    return rows.map((r) => {
      const expenses = expenseMap.get(r.branch_id) ?? 0;
      const grossProfit = r.revenue - r.cost;
      const netProfit = grossProfit - expenses;
      return {
        branchId: r.branch_id,
        branchName: r.branch_name,
        revenue: r.revenue,
        cost: r.cost,
        grossProfit,
        expenses,
        netProfit,
        grossMargin:
          r.revenue > 0
            ? Math.round((grossProfit / r.revenue) * 1000) / 10
            : 0,
        netMargin:
          r.revenue > 0
            ? Math.round((netProfit / r.revenue) * 1000) / 10
            : 0,
        contribution:
          totalRevenue > 0
            ? Math.round((r.revenue / totalRevenue) * 1000) / 10
            : 0,
      };
    });
  }

  async getTrend(
    companyId: string | null,
    days: number = 30,
    branchId?: string,
  ): Promise<ProfitTrendEntry[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const bc = this.branchClause(branchId, "t", 2);
    const trendParams: unknown[] = [startDate, ...bc.params];
    let trendCompanyCond = "";
    if (companyId) {
      trendParams.push(companyId);
      trendCompanyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${trendParams.length})`;
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { d: Date; revenue: number; cost: number }[]
    >(
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
        ${trendCompanyCond}
      GROUP BY DATE_TRUNC('day', t."createdAt")
      ORDER BY d ASC
      `,
      ...trendParams,
    );

    const dataMap = new Map<string, { revenue: number; cost: number }>();
    for (const row of rows) {
      const key = new Date(row.d).toISOString().slice(0, 10);
      dataMap.set(key, { revenue: row.revenue, cost: row.cost });
    }

    const result: ProfitTrendEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);
      const data = dataMap.get(key) || { revenue: 0, cost: 0 };
      result.push({
        date: date.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        }),
        revenue: data.revenue,
        cost: data.cost,
        profit: data.revenue - data.cost,
      });
    }
    return result;
  }

  async getMarginDistribution(
    companyId: string | null,
    branchId?: string,
  ): Promise<MarginDistributionEntry[]> {
    const bc = this.branchClause(branchId, "t", 1);
    const marginParams: unknown[] = [...bc.params];
    let marginCompanyCond = "";
    if (companyId) {
      marginParams.push(companyId);
      marginCompanyCond = `AND t."branchId" IN (SELECT id FROM branches WHERE "companyId" = $${marginParams.length})`;
    }

    const rows = await this.prisma.$queryRawUnsafe<
      { product_name: string; revenue: number; cost: number }[]
    >(
      `
      SELECT
        ti."productName" AS product_name,
        SUM(ti."subtotal")::float AS revenue,
        SUM(ti."quantity" * p."purchasePrice")::float AS cost
      FROM transactions t
      JOIN transaction_items ti ON ti."transactionId" = t."id"
      JOIN products p ON p."id" = ti."productId"
      WHERE t."status" = 'COMPLETED'
        ${bc.condition}
        ${marginCompanyCond}
      GROUP BY ti."productName"
      HAVING SUM(ti."subtotal") > 0
      `,
      ...marginParams,
    );

    const brackets = [
      { label: "0-10%", min: 0, max: 10, count: 0, revenue: 0 },
      { label: "10-20%", min: 10, max: 20, count: 0, revenue: 0 },
      { label: "20-30%", min: 20, max: 30, count: 0, revenue: 0 },
      { label: "30-50%", min: 30, max: 50, count: 0, revenue: 0 },
      { label: "50%+", min: 50, max: 999, count: 0, revenue: 0 },
    ];

    for (const row of rows) {
      const margin = ((row.revenue - row.cost) / row.revenue) * 100;
      for (const bracket of brackets) {
        if (margin >= bracket.min && margin < bracket.max) {
          bracket.count++;
          bracket.revenue += row.revenue;
          break;
        }
      }
    }

    return brackets.map((b) => ({
      label: b.label,
      count: b.count,
      revenue: b.revenue,
    }));
  }
}
