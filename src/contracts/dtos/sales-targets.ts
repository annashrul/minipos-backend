import { z } from "zod";

// Schema actual (packages/db/prisma/schema.prisma:1372) menggunakan
// targetRevenue/targetTx/targetItems/period/isActive (BUKAN targetAmount/
// achievedAmount/startDate/endDate/status/companyId). Tidak ada field
// `status` di model — kita derive status dari isActive + perbandingan
// targetRevenue vs revenue actual saat re-compute.
export const SalesTargetTypeSchema = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "CUSTOM",
]);
export type SalesTargetTypeDto = z.infer<typeof SalesTargetTypeSchema>;

export const SalesTargetStatusSchema = z.enum([
  "ACTIVE",
  "COMPLETED",
  "FAILED",
]);
export type SalesTargetStatusDto = z.infer<typeof SalesTargetStatusSchema>;

export const ListSalesTargetsQuerySchema = z.object({
  search: z.string().optional(),
  type: SalesTargetTypeSchema.optional(),
  branchId: z.string().optional(),
  userId: z.string().optional(),
  status: SalesTargetStatusSchema.optional(),
  period: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListSalesTargetsQueryDto = z.infer<
  typeof ListSalesTargetsQuerySchema
>;

export const CreateSalesTargetSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: SalesTargetTypeSchema,
    branchId: z.string().nullable().optional(),
    userId: z.string().nullable().optional(),
    targetAmount: z.number().nonnegative().optional(),
    targetRevenue: z.number().nonnegative().nullable().optional(),
    targetTx: z.number().int().nonnegative().nullable().optional(),
    targetItems: z.number().int().nonnegative().nullable().optional(),
    period: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine(
    (v) =>
      v.targetRevenue != null ||
      v.targetTx != null ||
      v.targetItems != null ||
      v.targetAmount != null,
    {
      message:
        "Minimal salah satu target harus diisi (targetRevenue/targetTx/targetItems)",
      path: ["targetRevenue"],
    },
  );
export type CreateSalesTargetDto = z.infer<typeof CreateSalesTargetSchema>;

export const UpdateSalesTargetSchema = z.object({
  name: z.string().min(1).optional(),
  type: SalesTargetTypeSchema.optional(),
  branchId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  targetAmount: z.number().nonnegative().optional(),
  targetRevenue: z.number().nonnegative().nullable().optional(),
  targetTx: z.number().int().nonnegative().nullable().optional(),
  targetItems: z.number().int().nonnegative().nullable().optional(),
  period: z.string().min(1).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateSalesTargetDto = z.infer<typeof UpdateSalesTargetSchema>;

export type SalesTargetResponse = {
  id: string;
  name: string | null;
  type: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  userId: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
  // Field schema (kept as-is)
  targetRevenue: number | null;
  targetTx: number | null;
  targetItems: number | null;
  period: string;
  isActive: boolean;
  // Derived saat /:id/recompute dipanggil
  achievedAmount: number;
  achievedTx: number;
  achievedItems: number;
  startDate: string;
  endDate: string;
  status: SalesTargetStatusDto;
  createdAt: string;
  updatedAt: string;
};

export type SalesTargetListResponse = {
  salesTargets: SalesTargetResponse[];
  total: number;
  totalPages: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard (peringkat user berdasarkan revenue dalam periode)
// ─────────────────────────────────────────────────────────────────────────────

export const LeaderboardQuerySchema = z.object({
  // Period string e.g. "2026-04" (MONTHLY default), "2026-W14", "2026-04-04"
  period: z.string().optional(),
  type: SalesTargetTypeSchema.optional(),
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type LeaderboardQueryDto = z.infer<typeof LeaderboardQuerySchema>;

export type LeaderboardEntryDto = {
  rank: number;
  userId: string;
  name: string;
  avatarInitial: string;
  revenue: number;
  target: number;
  percentage: number;
  transactions: number;
  itemsSold: number;
  badges: { badge: string; title: string }[];
};

export type LeaderboardResponse = {
  leaderboard: LeaderboardEntryDto[];
  period: string;
  type: SalesTargetTypeDto;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sales Badges (CashierBadge model — terpisah dari cashier.badges yang pakai
// `level`. Schema ini menggunakan field title/description/period sesuai model.)
// ─────────────────────────────────────────────────────────────────────────────

export const GetSalesBadgesQuerySchema = z.object({
  userId: z.string().optional(),
});
export type GetSalesBadgesQueryDto = z.infer<typeof GetSalesBadgesQuerySchema>;

export type SalesBadgeResponse = {
  id: string;
  userId: string;
  badge: string;
  title: string;
  description: string | null;
  period: string | null;
  earnedAt: string;
  user: { id: string; name: string } | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Evaluate badges (cron-like batch auto-award)
// ─────────────────────────────────────────────────────────────────────────────

export const EvaluateBadgesSchema = z.object({
  // MONTHLY period e.g. "2026-04". Default current month.
  period: z.string().optional(),
});
export type EvaluateBadgesDto = z.infer<typeof EvaluateBadgesSchema>;

export type EvaluateBadgesResponse = {
  awarded: { userId: string; badge: string; title: string }[];
  period: string;
};
