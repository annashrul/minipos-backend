import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SalesTargetTypeDto } from "@/contracts";

export const BADGE_DEFINITIONS: {
  key: string;
  title: string;
  description: string;
}[] = [
  {
    key: "TOP_SELLER",
    title: "Top Seller",
    description: "Pendapatan tertinggi dalam periode",
  },
  {
    key: "ZERO_VOID",
    title: "Zero Void",
    description: "Tidak ada transaksi void dalam periode",
  },
  {
    key: "TARGET_CRUSHER",
    title: "Target Crusher",
    description: "Melampaui target 120%+",
  },
  {
    key: "STREAK_7",
    title: "7-Day Streak",
    description: "Mencapai target 7 hari berturut-turut",
  },
  {
    key: "SPEED_DEMON",
    title: "Speed Demon",
    description: "Transaksi terbanyak dalam periode",
  },
  {
    key: "EARLY_BIRD",
    title: "Early Bird",
    description: "Transaksi terbanyak sebelum jam 10 pagi",
  },
  {
    key: "NIGHT_OWL",
    title: "Night Owl",
    description: "Transaksi terbanyak setelah jam 8 malam",
  },
  {
    key: "TEAM_PLAYER",
    title: "Team Player",
    description: "Membantu banyak cabang (multi-branch)",
  },
];

export const SALES_TARGET_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true, email: true, role: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  type: true,
  targetRevenue: true,
  targetTx: true,
  targetItems: true,
  period: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SalesTargetSelect;

export type RawSalesTarget = Prisma.SalesTargetGetPayload<{
  select: typeof SALES_TARGET_SELECT;
}>;

export function tenantWhere(companyId: string): Prisma.SalesTargetWhereInput {
  return {
    OR: [
      { user: { is: { companyId } } },
      { userId: null, branch: { is: { companyId } } },
      { userId: null, branchId: null },
    ],
  };
}

export function throwOnDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(
      "Sales target sudah ada untuk user/type/period tersebut",
    );
  }
}

export function getCurrentPeriod(type: SalesTargetTypeDto): string {
  const now = new Date();
  if (type === "DAILY") return now.toISOString().slice(0, 10);
  if (type === "WEEKLY") {
    const d = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function derivePeriod(
  type: SalesTargetTypeDto,
  startDate?: string,
): string {
  const d = startDate ? new Date(startDate) : new Date();
  if (type === "DAILY") return d.toISOString().slice(0, 10);
  if (type === "WEEKLY") {
    const tmp = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
  if (type === "QUARTERLY") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  if (type === "YEARLY") return `${d.getFullYear()}`;
  if (type === "CUSTOM") return `CUSTOM-${d.toISOString().slice(0, 10)}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getPeriodRange(
  type: string,
  period: string,
): { start: Date; end: Date } {
  if (type === "DAILY") {
    return {
      start: new Date(`${period}T00:00:00.000Z`),
      end: new Date(`${period}T23:59:59.999Z`),
    };
  }
  if (type === "WEEKLY") {
    const [yearStr, weekStr] = period.split("-W");
    const year = Number(yearStr ?? new Date().getFullYear());
    const week = Number(weekStr ?? 1);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
    const start = new Date(startOfWeek1);
    start.setUTCDate(startOfWeek1.getUTCDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }
  if (type === "QUARTERLY") {
    const [yearStr, qStr] = period.split("-Q");
    const year = Number(yearStr ?? new Date().getFullYear());
    const q = Number(qStr ?? 1);
    const startMonth = (q - 1) * 3;
    const start = new Date(Date.UTC(year, startMonth, 1));
    const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
    return { start, end };
  }
  if (type === "YEARLY") {
    const year = Number(period);
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    };
  }
  if (type === "CUSTOM") {
    const dateStr = period.replace(/^CUSTOM-/, "");
    return {
      start: new Date(`${dateStr}T00:00:00.000Z`),
      end: new Date(`${dateStr}T23:59:59.999Z`),
    };
  }
  // MONTHLY
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr ?? new Date().getFullYear());
  const month = Number(monthStr ?? 1) - 1;
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  };
}
