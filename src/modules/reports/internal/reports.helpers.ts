import type { AgingBucketKey } from "@/contracts";

export function bucketKey(
  date: Date,
  groupBy: "day" | "week" | "month",
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (groupBy === "day") return `${y}-${m}-${d}`;
  if (groupBy === "month") return `${y}-${m}`;
  // week: ISO week
  const tmp = new Date(Date.UTC(y, date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function computeAgingBucket(
  dueDate: Date | null,
  now: Date,
): AgingBucketKey {
  if (!dueDate || dueDate.getTime() >= now.getTime()) return "current";
  const overdueDays = Math.floor(
    (now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (overdueDays <= 30) return "1-30";
  if (overdueDays <= 60) return "31-60";
  if (overdueDays <= 90) return "61-90";
  return "90+";
}

export function buildSalesViewWhere(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  branchId: string | undefined,
  alias: string,
  companyId: string,
): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (dateFrom) {
    params.push(new Date(dateFrom + "T00:00:00"));
    conds.push(`${alias}.tx_created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(new Date(dateTo + "T23:59:59"));
    conds.push(`${alias}.tx_created_at <= $${params.length}`);
  }
  if (branchId) {
    params.push(branchId);
    conds.push(`${alias}.branch_id = $${params.length}`);
  }
  params.push(companyId);
  conds.push(`${alias}.company_id = $${params.length}`);
  return { where: conds.join(" AND "), params };
}
