import { Prisma } from "@prisma/client";
import type {
  CashierBadgeResponse,
  CashierFavoriteResponse,
} from "@/contracts";

// We encode (badge, level) into the DB `badge` field using a separator,
// because the schema doesn't have a dedicated `level` column.
// Format: `${badgeKey}#${level}` (e.g. "TOP_SELLER#1", "VOLUME_KING#3").
export const LEVEL_SEPARATOR = "#";

export const FAVORITE_SELECT = {
  id: true,
  userId: true,
  productId: true,
  sortOrder: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      sellingPrice: true,
      imageUrl: true,
      companyId: true,
    },
  },
} satisfies Prisma.CashierFavoriteSelect;

export type RawFavorite = Prisma.CashierFavoriteGetPayload<{
  select: typeof FAVORITE_SELECT;
}>;

export const BADGE_SELECT = {
  id: true,
  userId: true,
  badge: true,
  earnedAt: true,
} satisfies Prisma.CashierBadgeSelect;

export type RawBadge = Prisma.CashierBadgeGetPayload<{
  select: typeof BADGE_SELECT;
}>;

export type AutoAwardRule = {
  badge: string;
  level: number;
  threshold: number;
};

export const TOP_SELLER_RULES: AutoAwardRule[] = [
  { badge: "TOP_SELLER", level: 1, threshold: 50_000_000 },
  { badge: "TOP_SELLER", level: 2, threshold: 100_000_000 },
  { badge: "TOP_SELLER", level: 3, threshold: 200_000_000 },
];

export const VOLUME_KING_RULES: AutoAwardRule[] = [
  { badge: "VOLUME_KING", level: 1, threshold: 100 },
  { badge: "VOLUME_KING", level: 2, threshold: 300 },
  { badge: "VOLUME_KING", level: 3, threshold: 500 },
];

export function toFavoriteResponse(f: RawFavorite): CashierFavoriteResponse {
  return {
    id: f.id,
    userId: f.userId,
    productId: f.productId,
    sortOrder: f.sortOrder,
    product: {
      id: f.product.id,
      code: f.product.code,
      name: f.product.name,
      sellingPrice: f.product.sellingPrice,
      imageUrl: f.product.imageUrl,
    },
    createdAt: f.createdAt.toISOString(),
  };
}

export function toBadgeResponse(b: RawBadge): CashierBadgeResponse {
  const { badge, level } = decodeBadge(b.badge);
  return {
    id: b.id,
    userId: b.userId,
    badge,
    level,
    earnedAt: b.earnedAt.toISOString(),
  };
}

export function encodeBadge(badge: string, level: number): string {
  return `${badge}${LEVEL_SEPARATOR}${level}`;
}

export function decodeBadge(stored: string): { badge: string; level: number } {
  const idx = stored.lastIndexOf(LEVEL_SEPARATOR);
  if (idx === -1) {
    return { badge: stored, level: 1 };
  }
  const badge = stored.slice(0, idx);
  const levelRaw = stored.slice(idx + 1);
  const level = Number.parseInt(levelRaw, 10);
  if (!Number.isFinite(level) || level < 1) {
    return { badge: stored, level: 1 };
  }
  return { badge, level };
}

export function makeBadgeTitle(badge: string, level: number): string {
  return `${badge} L${level}`;
}

export function monthRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

export function periodRange(
  period: "today" | "week" | "month" | "year",
  now: Date,
): { start: Date; end: Date } {
  if (period === "today") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0,
    );
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23, 59, 59, 999,
    );
    return { start, end };
  }
  if (period === "week") {
    const dayOfWeek = now.getDay() || 7; // Mon=1..Sun=7
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (dayOfWeek - 1),
      0, 0, 0, 0,
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
      23, 59, 59, 999,
    );
    return { start: monday, end: sunday };
  }
  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end };
  }
  return monthRange(now);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
