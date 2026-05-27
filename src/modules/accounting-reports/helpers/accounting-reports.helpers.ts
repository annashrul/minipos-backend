import { round2 } from "@/common/utils/math";
import type { CashFlowByTypeResponse } from "../dto/accounting-reports.dto";

export function toDate(iso: string): Date {
  return new Date(iso);
}

export function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function dateToIso(d: Date | string): string {
  if (typeof d === "string") return d;
  return d.toISOString();
}

export function summarizeCashByType(
  rows: { referenceType: string | null; amount: number }[],
): CashFlowByTypeResponse[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const type = r.referenceType || "LAINNYA";
    map.set(type, (map.get(type) ?? 0) + r.amount);
  }

  const labels: Record<string, string> = {
    TRANSACTION: "Penjualan",
    PURCHASE: "Pembelian",
    RETURN: "Retur",
    DEBT_PAYMENT: "Pembayaran Hutang/Piutang",
    EXPENSE: "Pengeluaran Operasional",
    MANUAL: "Jurnal Manual",
    LAINNYA: "Lainnya",
  };

  return Array.from(map.entries()).map(([type, amount]) => ({
    type,
    description: labels[type] ?? type,
    amount: round2(amount),
  }));
}
