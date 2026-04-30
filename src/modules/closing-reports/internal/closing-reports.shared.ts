import { Prisma } from "@prisma/client";
import type {
  ClosingReportResponse,
  PaymentSummaryEntry,
} from "@/contracts";

export const CLOSING_REPORT_SELECT = {
  id: true,
  shiftId: true,
  cashierUserId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  companyId: true,
  cashierName: true,
  date: true,
  openingCash: true,
  closingCash: true,
  expectedCash: true,
  cashDifference: true,
  totalTransactions: true,
  totalSales: true,
  totalDiscount: true,
  totalTax: true,
  totalCashSales: true,
  totalNonCashSales: true,
  cashMovementIn: true,
  cashMovementOut: true,
  voidCount: true,
  refundCount: true,
  paymentSummary: true,
  notes: true,
  allowReopen: true,
  createdAt: true,
  shift: {
    select: {
      id: true,
      openedAt: true,
      closedAt: true,
    },
  },
} satisfies Prisma.ClosingReportSelect;

export type RawClosingReport = Prisma.ClosingReportGetPayload<{
  select: typeof CLOSING_REPORT_SELECT;
}>;

export function tenantWhere(
  companyId: string,
): Prisma.ClosingReportWhereInput {
  return {
    OR: [{ companyId }, { branch: { companyId } }],
  };
}

export function toClosingReportResponse(
  r: RawClosingReport,
): ClosingReportResponse {
  const paymentSummary = parsePaymentSummary(r.paymentSummary);
  return {
    id: r.id,
    shiftId: r.shiftId,
    cashierUserId: r.cashierUserId,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    companyId: r.companyId,
    cashierName: r.cashierName,
    date: r.date.toISOString(),
    openedAt: r.shift?.openedAt ? r.shift.openedAt.toISOString() : null,
    closedAt: r.shift?.closedAt ? r.shift.closedAt.toISOString() : null,
    openingCash: r.openingCash,
    closingCash: r.closingCash,
    expectedCash: r.expectedCash,
    cashDifference: r.cashDifference,
    totalTransactions: r.totalTransactions,
    totalSales: r.totalSales,
    totalDiscount: r.totalDiscount,
    totalTax: r.totalTax,
    totalCashSales: r.totalCashSales,
    totalNonCashSales: r.totalNonCashSales,
    cashMovementIn: r.cashMovementIn,
    cashMovementOut: r.cashMovementOut,
    voidCount: r.voidCount,
    refundCount: r.refundCount,
    paymentSummary,
    notes: r.notes,
    allowReopen: r.allowReopen,
    createdAt: r.createdAt.toISOString(),
  };
}

export function parsePaymentSummary(
  value: Prisma.JsonValue | null,
): PaymentSummaryEntry[] | null {
  if (!value || !Array.isArray(value)) return null;
  const result: PaymentSummaryEntry[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).method === "string" &&
      typeof (item as Record<string, unknown>).count === "number" &&
      typeof (item as Record<string, unknown>).total === "number"
    ) {
      const obj = item as Record<string, unknown>;
      result.push({
        method: obj.method as string,
        count: obj.count as number,
        total: obj.total as number,
      });
    }
  }
  return result;
}
