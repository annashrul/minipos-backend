import { z } from "zod";

// =============================================
// Enums
// =============================================

export const AccountingPeriodStatusSchema = z.enum([
  "OPEN",
  "CLOSED",
  "LOCKED",
]);
export type AccountingPeriodStatusDto = z.infer<
  typeof AccountingPeriodStatusSchema
>;

// =============================================
// Query / List
// =============================================

export const ListAccountingPeriodsQuerySchema = z.object({
  search: z.string().optional(),
  status: AccountingPeriodStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum(["name", "startDate", "endDate", "status", "createdAt"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListAccountingPeriodsQueryDto = z.infer<
  typeof ListAccountingPeriodsQuerySchema
>;

// =============================================
// Create / Update
// =============================================

export const CreateAccountingPeriodSchema = z
  .object({
    name: z.string().min(1, "Nama periode wajib diisi"),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine(
    (data) => new Date(data.endDate).getTime() > new Date(data.startDate).getTime(),
    {
      message: "Tanggal akhir harus lebih besar dari tanggal mulai",
      path: ["endDate"],
    },
  );
export type CreateAccountingPeriodDto = z.infer<
  typeof CreateAccountingPeriodSchema
>;

export const UpdateAccountingPeriodSchema = z
  .object({
    name: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate).getTime() > new Date(data.startDate).getTime();
      }
      return true;
    },
    {
      message: "Tanggal akhir harus lebih besar dari tanggal mulai",
      path: ["endDate"],
    },
  );
export type UpdateAccountingPeriodDto = z.infer<
  typeof UpdateAccountingPeriodSchema
>;

// =============================================
// Responses
// =============================================

export type AccountingPeriodResponse = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: string | null;
  closedBy: string | null;
  journalCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AccountingPeriodListResponse = {
  periods: AccountingPeriodResponse[];
  total: number;
  totalPages: number;
};
