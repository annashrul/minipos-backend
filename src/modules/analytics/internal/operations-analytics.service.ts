import { Injectable } from "@nestjs/common";
import type {
  CashierPerformanceEntry,
  DailyProfitEntry,
  ShiftProfitEntry,
  UnusualDiscountResponse,
  VoidAbuseEntryResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";

const VOID_SUSPICIOUS_THRESHOLD = 5;
const UNUSUAL_DISCOUNT_PERCENT = 20;

@Injectable()
export class OperationsAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getVoidAbuseDetection(
    companyId: string,
    _branchId?: string,
  ): Promise<VoidAbuseEntryResponse[]> {
    const sevenDaysAgo = daysAgo(7);

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
      suspicious: r.voidCount > VOID_SUSPICIOUS_THRESHOLD,
    }));
  }

  async getUnusualDiscounts(
    companyId: string,
    _branchId?: string,
  ): Promise<UnusualDiscountResponse[]> {
    const sevenDaysAgo = daysAgo(7);

    const transactions = await this.prisma.$queryRawUnsafe<
      {
        invoiceNumber: string;
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
        AND (t."discountAmount" / t.subtotal) * 100 > ${UNUSUAL_DISCOUNT_PERCENT}
        AND u."companyId" = $2
      ORDER BY t."discountAmount" DESC
      `,
      sevenDaysAgo,
      companyId,
    );

    return transactions.map((tx) => ({
      invoiceNumber: tx.invoiceNumber,
      cashier: tx.cashierName,
      role: tx.role,
      subtotal: tx.subtotal,
      discountAmount: tx.discountAmount,
      discountPercent: (tx.discountAmount / tx.subtotal) * 100,
      grandTotal: tx.grandTotal,
      createdAt: tx.createdAt,
    }));
  }

  async getDailyProfit(
    companyId: string,
    _branchId?: string,
  ): Promise<DailyProfitEntry[]> {
    const thirtyDaysAgo = daysAgo(30);

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

  async getCashierPerformance(
    companyId: string,
    _branchId?: string,
  ): Promise<CashierPerformanceEntry[]> {
    const thirtyDaysAgo = daysAgo(30);

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
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
