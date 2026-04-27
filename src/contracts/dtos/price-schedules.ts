import { z } from "zod";

// Schema actual (packages/db/prisma/schema.prisma:1411) memakai
// newPrice/originalPrice/appliedAt/revertedAt/reason (BUKAN
// scheduledPrice/applied/notes). companyId nullable.

export const ListPriceSchedulesQuerySchema = z.object({
  search: z.string().optional(),
  productId: z.string().optional(),
  branchId: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  applied: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListPriceSchedulesQueryDto = z.infer<
  typeof ListPriceSchedulesQuerySchema
>;

export const CreatePriceScheduleSchema = z
  .object({
    productId: z.string().min(1),
    branchId: z.string().nullable().optional(),
    // Terima `scheduledPrice` (alias spec) atau `newPrice` (schema).
    scheduledPrice: z.number().nonnegative().optional(),
    newPrice: z.number().nonnegative().optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    notes: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine((v) => v.scheduledPrice != null || v.newPrice != null, {
    message: "scheduledPrice atau newPrice wajib diisi",
    path: ["scheduledPrice"],
  })
  .refine((v) => new Date(v.endDate) > new Date(v.startDate), {
    message: "endDate harus > startDate",
    path: ["endDate"],
  });
export type CreatePriceScheduleDto = z.infer<typeof CreatePriceScheduleSchema>;

export const UpdatePriceScheduleSchema = z.object({
  branchId: z.string().nullable().optional(),
  scheduledPrice: z.number().nonnegative().optional(),
  newPrice: z.number().nonnegative().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePriceScheduleDto = z.infer<typeof UpdatePriceScheduleSchema>;

export type PriceScheduleResponse = {
  id: string;
  productId: string;
  product: { id: string; name: string; code: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  scheduledPrice: number; // alias of newPrice (sesuai spec)
  newPrice: number; // schema actual
  originalPrice: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  applied: boolean; // derived: appliedAt != null
  appliedAt: string | null;
  revertedAt: string | null;
  notes: string | null; // alias of reason
  reason: string | null;
  createdAt: string;
};

export type PriceScheduleListResponse = {
  schedules: PriceScheduleResponse[];
  total: number;
  totalPages: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Cron-like batch endpoints
// ─────────────────────────────────────────────────────────────────────────────

// applyDuePriceSchedules: terapkan semua schedule yang sudah due (startDate
// <= now & belum applied). Sekaligus revert yang sudah expired (endDate <= now
// & sudah applied & belum reverted) — meniru perilaku server action lama.
export type ApplyDuePriceSchedulesResponse = {
  success: true;
  appliedCount: number;
  revertedCount: number;
};

// revertExpiredPriceSchedules: hanya revert harga yang expired.
export type RevertExpiredPriceSchedulesResponse = {
  success: true;
  revertedCount: number;
};
