import { Injectable } from "@nestjs/common";
import { toDateOnly } from "@/common/utils/date";
import { round2 } from "@/common/utils/math";
import type {
  MarginDistributionEntry,
  ProfitByBranchEntry,
  ProfitByCategoryEntry,
  ProfitByProductEntry,
  ProfitOverviewResponse,
  ProfitPeriodDto,
  ProfitTrendEntry,
} from "./dto/profit-dashboard.dto";
import { ProfitDashboardRepository } from "./profit-dashboard.repository";

type Period = ProfitPeriodDto;

type PeriodDates = {
  periodStart: Date;
  prevPeriodStart: Date;
  prevPeriodEnd: Date;
  periodEnd: Date;
};

@Injectable()
export class ProfitDashboardService {
  constructor(private readonly repo: ProfitDashboardRepository) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  async getOverview(
    companyId: string | null,
    period: Period,
    branchId?: string,
  ): Promise<ProfitOverviewResponse> {
    const { periodStart, prevPeriodStart, prevPeriodEnd, periodEnd } =
      this.getPeriodDates(period);

    const [current, prev] = await Promise.all([
      this.repo.getProfitMetrics(
        periodStart,
        periodEnd,
        branchId || null,
        companyId,
      ),
      this.repo.getProfitMetrics(
        prevPeriodStart,
        prevPeriodEnd,
        branchId || null,
        companyId,
      ),
    ]);

    const revenue = current?.revenue ?? 0;
    const cogs = current?.cogs ?? 0;
    const grossProfit = current?.grossProfit ?? 0;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const expenses = current?.expense ?? 0;
    const netProfit = current?.netProfit ?? 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    const prevRevenue = prev?.revenue ?? 0;
    const prevCogs = prev?.cogs ?? 0;
    const prevGrossProfit = prev?.grossProfit ?? 0;
    const prevExpensesTotal = prev?.expense ?? 0;
    const prevNetProfit = prev?.netProfit ?? 0;

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
      grossMargin: round2(grossMargin),
      expenses,
      netProfit,
      netMargin: round2(netMargin),
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
      grossProfitGrowth: Math.round(grossProfitGrowth * 10) / 10,
      netProfitGrowth: Math.round(netProfitGrowth * 10) / 10,
      cogsGrowth: Math.round(cogsGrowth * 10) / 10,
      expensesGrowth: Math.round(expensesGrowth * 10) / 10,
      transactionCount: Number(current?.transactionCount ?? 0),
    };
  }

  async getByCategory(
    companyId: string | null,
    period: Period,
    branchId?: string,
  ): Promise<ProfitByCategoryEntry[]> {
    const { periodStart, periodEnd } = this.getPeriodDates(period);

    const rows = await this.repo.findByCategory(
      periodStart,
      periodEnd,
      branchId,
      companyId,
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

    const rows = await this.repo.findByProduct(
      periodStart,
      periodEnd,
      branchId,
      companyId,
      limit,
      sortDir,
    );

    return rows.map((r) => ({
      productName: r.productName,
      productCode: r.productCode,
      unitsSold: r.unitsSold,
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

    const [rows, expenseRows] = await Promise.all([
      this.repo.findBranchRevenue(periodStart, periodEnd, companyId),
      this.repo.findBranchExpenses(periodStart, periodEnd, companyId),
    ]);

    const expenseMap = new Map(expenseRows.map((e) => [e.branchId, e.total]));
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

    return rows.map((r) => {
      const expenses = expenseMap.get(r.branchId) ?? 0;
      const grossProfit = r.revenue - r.cost;
      const netProfit = grossProfit - expenses;
      return {
        branchId: r.branchId,
        branchName: r.branchName,
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

    const rows = await this.repo.findTrend(startDate, branchId, companyId);

    const dataMap = new Map<string, { revenue: number; cost: number }>();
    for (const row of rows) {
      const key = toDateOnly(row.d);
      dataMap.set(key, { revenue: row.revenue, cost: row.cost });
    }

    const result: ProfitTrendEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const key = toDateOnly(date);
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
    const rows = await this.repo.findMarginDistribution(branchId, companyId);

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
