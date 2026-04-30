import type { DashboardStatsQueryDto } from "@/contracts";

export type RangeBounds = { from: Date; to: Date };

export function resolveRange(
  period: DashboardStatsQueryDto["period"],
): RangeBounds {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "yesterday":
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case "week": {
      const day = start.getDay();
      const diff = (day + 6) % 7;
      start.setDate(start.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
  }
  return { from: start, to: end };
}

export function resolvePrevRange(
  period: DashboardStatsQueryDto["period"],
  range: RangeBounds,
): RangeBounds {
  const from = new Date(range.from);
  const to = new Date(range.to);

  switch (period) {
    case "today":
    case "yesterday": {
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
      return { from, to };
    }
    case "week": {
      from.setDate(from.getDate() - 7);
      to.setDate(to.getDate() - 7);
      return { from, to };
    }
    case "month": {
      from.setMonth(from.getMonth() - 1);
      to.setMonth(to.getMonth() - 1);
      return { from, to };
    }
    case "year": {
      from.setFullYear(from.getFullYear() - 1);
      to.setFullYear(to.getFullYear() - 1);
      return { from, to };
    }
  }
}

/**
 * Push branch filter into a $queryRawUnsafe params array and return SQL
 * fragment to splice into a WHERE clause. Mutates `params`.
 */
export function buildBranchCondition(
  params: unknown[],
  branchId: string | undefined,
  companyBranchIds: string[],
  tableAlias?: string,
): string {
  const col = tableAlias ? `${tableAlias}."branchId"` : `"branchId"`;
  if (branchId) {
    params.push(branchId);
    return `AND ${col} = $${params.length}`;
  }
  if (companyBranchIds.length > 0) {
    const placeholders = companyBranchIds
      .map((_, i) => `$${params.length + i + 1}`)
      .join(",");
    params.push(...companyBranchIds);
    return `AND ${col} IN (${placeholders})`;
  }
  return "AND 1=0";
}
