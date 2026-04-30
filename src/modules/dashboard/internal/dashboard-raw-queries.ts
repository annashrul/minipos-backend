import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { buildBranchCondition } from "./dashboard.helpers";

const MONTH_NAMES_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

export type DailySalesRow = { date: string; total: number; count: number };
export type YearlyRow = {
  month: string;
  thisYear: number;
  lastYear: number;
  thisYearCount: number;
  lastYearCount: number;
};
export type CashierRow = { name: string; total: number; count: number };
export type CategoryRow = { name: string; total: number; qty: number };
export type HourlySalesRow = { hour: string; total: number; count: number };
export type ProfitRow = { profit: number };

@Injectable()
export class DashboardRawQueries {
  constructor(private readonly prisma: PrismaService) {}

  async dailySales(
    days: number,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<DailySalesRow[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const params: unknown[] = [startDate];
    const branchCondition = buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );

    const rows = await this.prisma.$queryRawUnsafe<
      { d: Date; total: bigint; count: bigint }[]
    >(
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

    const salesMap = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      const dateKey = new Date(row.d).toISOString().slice(0, 10);
      salesMap.set(dateKey, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    const result: DailySalesRow[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().slice(0, 10);
      const data = salesMap.get(dateKey) || { total: 0, count: 0 };
      result.push({
        date: date.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        }),
        total: data.total,
        count: data.count,
      });
    }
    return result;
  }

  async yearlyComparison(
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<YearlyRow[]> {
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;

    const params: unknown[] = [new Date(lastYear, 0, 1)];
    const branchCondition = buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );

    const rows = await this.prisma.$queryRawUnsafe<
      { y: number; m: number; total: bigint; count: bigint }[]
    >(
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

    const dataMap = new Map<string, { total: number; count: number }>();
    for (const row of rows) {
      dataMap.set(`${row.y}-${row.m}`, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    return MONTH_NAMES_ID.map((month, i) => {
      const thisData = dataMap.get(`${thisYear}-${i + 1}`) || {
        total: 0,
        count: 0,
      };
      const lastData = dataMap.get(`${lastYear}-${i + 1}`) || {
        total: 0,
        count: 0,
      };
      return {
        month,
        thisYear: thisData.total,
        lastYear: lastData.total,
        thisYearCount: thisData.count,
        lastYearCount: lastData.count,
      };
    });
  }

  async topCashiers(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<CashierRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
      "t",
    );

    return this.prisma.$queryRawUnsafe<CashierRow[]>(
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

  async categoryBreakdown(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<CategoryRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
      "t",
    );

    return this.prisma.$queryRawUnsafe<CategoryRow[]>(
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

  async hourlySales(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<HourlySalesRow[]> {
    const params: unknown[] = [start, end];
    const branchCondition = buildBranchCondition(
      params,
      branchId,
      companyBranchIds,
    );

    const rows = await this.prisma.$queryRawUnsafe<
      { h: number; total: bigint; count: bigint }[]
    >(
      `
      SELECT EXTRACT(HOUR FROM "createdAt")::int as h,
             COALESCE(SUM("grandTotal"), 0) as total,
             COUNT(*)::bigint as count
      FROM transactions
      WHERE "createdAt" >= $1
        AND "createdAt" < $2
        AND "status" = 'COMPLETED'
        ${branchCondition}
      GROUP BY EXTRACT(HOUR FROM "createdAt")
      ORDER BY h
      `,
      ...params,
    );

    const hoursMap = new Map<number, { total: number; count: number }>();
    for (const row of rows) {
      hoursMap.set(row.h, {
        total: Number(row.total),
        count: Number(row.count),
      });
    }

    return Array.from({ length: 24 }, (_, i) => {
      const data = hoursMap.get(i) || { total: 0, count: 0 };
      return {
        hour: `${String(i).padStart(2, "0")}:00`,
        total: data.total,
        count: data.count,
      };
    });
  }

  async periodProfit(
    start: Date,
    end: Date,
    branchId: string | undefined,
    companyBranchIds: string[],
  ): Promise<number> {
    const params: unknown[] = [start, end];
    let profitBranchCond = "";
    if (branchId) {
      params.push(branchId);
      profitBranchCond = `AND t."branchId" = $${params.length}`;
    } else if (companyBranchIds.length > 0) {
      profitBranchCond = `AND t."branchId" IN (${companyBranchIds
        .map((_, i) => `$${params.length + i + 1}`)
        .join(",")})`;
      params.push(...companyBranchIds);
    } else {
      profitBranchCond = "AND 1=0";
    }

    const rows = await this.prisma.$queryRawUnsafe<ProfitRow[]>(
      `
      SELECT COALESCE(SUM((ti."unitPrice" - p."purchasePrice") * ti.quantity), 0)::float AS profit
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN products p ON p.id = ti."productId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1 AND t."createdAt" < $2
        ${profitBranchCond}
      `,
      ...params,
    );
    return rows[0]?.profit ?? 0;
  }
}
