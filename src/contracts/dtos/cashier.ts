import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Favorites
// ─────────────────────────────────────────────────────────────────────────────

export const ListCashierFavoritesQuerySchema = z.object({
  userId: z.string().optional(),
});
export type ListCashierFavoritesQueryDto = z.infer<
  typeof ListCashierFavoritesQuerySchema
>;

export const CreateCashierFavoriteSchema = z.object({
  productId: z.string().min(1),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateCashierFavoriteDto = z.infer<
  typeof CreateCashierFavoriteSchema
>;

export const UpdateCashierFavoriteSchema = z.object({
  sortOrder: z.number().int().min(0),
});
export type UpdateCashierFavoriteDto = z.infer<
  typeof UpdateCashierFavoriteSchema
>;

export const ReorderCashierFavoritesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type ReorderCashierFavoritesDto = z.infer<
  typeof ReorderCashierFavoritesSchema
>;

export type CashierFavoriteProductSummary = {
  id: string;
  code: string;
  name: string;
  sellingPrice: number;
  imageUrl: string | null;
};

export type CashierFavoriteResponse = {
  id: string;
  userId: string;
  productId: string;
  sortOrder: number;
  product: CashierFavoriteProductSummary;
  createdAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────────────

export const ListCashierBadgesQuerySchema = z.object({
  userId: z.string().optional(),
});
export type ListCashierBadgesQueryDto = z.infer<
  typeof ListCashierBadgesQuerySchema
>;

export const CreateCashierBadgeSchema = z.object({
  userId: z.string().min(1),
  badge: z.string().min(1),
  level: z.number().int().min(1),
});
export type CreateCashierBadgeDto = z.infer<typeof CreateCashierBadgeSchema>;

export const AutoAwardBadgesSchema = z.object({
  userId: z.string().optional(),
});
export type AutoAwardBadgesDto = z.infer<typeof AutoAwardBadgesSchema>;

export type CashierBadgeResponse = {
  id: string;
  userId: string;
  badge: string;
  level: number;
  earnedAt: string;
};

export type AutoAwardBadgesResponse = {
  awarded: number;
  badges: CashierBadgeResponse[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Performance
// ─────────────────────────────────────────────────────────────────────────────

export const CashierPerformanceQuerySchema = z.object({
  userId: z.string().optional(),
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type CashierPerformanceQueryDto = z.infer<
  typeof CashierPerformanceQuerySchema
>;

export const CashierPerformanceLeaderboardQuerySchema = z.object({
  period: z.enum(["today", "week", "month", "year"]).default("month"),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type CashierPerformanceLeaderboardQueryDto = z.infer<
  typeof CashierPerformanceLeaderboardQuerySchema
>;

export type CashierPerformanceResponse = {
  userId: string;
  userName: string;
  totalSales: number;
  totalTransactions: number;
  avgTransaction: number;
  totalDiscount: number;
  totalRefund: number;
  totalVoid: number;
  hoursWorked: number;
  salesPerHour: number;
  rankBySales: number;
  rankByTransactions: number;
};

export type CashierPerformanceListResponse = {
  performance: CashierPerformanceResponse[];
  total: number;
  from: string;
  to: string;
};
