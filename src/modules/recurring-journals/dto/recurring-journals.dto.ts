import { z } from "zod";

// =============================================
// Enums
// =============================================

export const RecurringFrequencySchema = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
]);
export type RecurringFrequencyDto = z.infer<typeof RecurringFrequencySchema>;

// =============================================
// Queries
// =============================================

export const ListRecurringJournalsQuerySchema = z.object({
  search: z.string().optional(),
  branchId: z.string().nullable().optional(),
  frequency: RecurringFrequencySchema.optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListRecurringJournalsQueryDto = z.infer<
  typeof ListRecurringJournalsQuerySchema
>;

// =============================================
// Mutations
// =============================================

export const RecurringJournalLineInputSchema = z
  .object({
    accountId: z.string().min(1),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    description: z.string().nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (line) =>
      (line.debit > 0 && line.credit === 0) ||
      (line.credit > 0 && line.debit === 0),
    {
      message: "Setiap baris harus memiliki nilai debit ATAU credit (>0)",
    },
  );
export type RecurringJournalLineInputDto = z.infer<
  typeof RecurringJournalLineInputSchema
>;

export const CreateRecurringJournalSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  frequency: RecurringFrequencySchema,
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
  nextRunDate: z.string().datetime(),
  isActive: z.boolean().optional(),
  lines: z
    .array(RecurringJournalLineInputSchema)
    .min(2, "Minimal 2 baris jurnal"),
});
export type CreateRecurringJournalDto = z.infer<
  typeof CreateRecurringJournalSchema
>;

export const UpdateRecurringJournalSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  frequency: RecurringFrequencySchema.optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
  nextRunDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
  lines: z.array(RecurringJournalLineInputSchema).min(2).optional(),
});
export type UpdateRecurringJournalDto = z.infer<
  typeof UpdateRecurringJournalSchema
>;

export const RunRecurringJournalSchema = z.object({
  post: z.boolean().optional(),
});
export type RunRecurringJournalDto = z.infer<typeof RunRecurringJournalSchema>;

export const ToggleRecurringJournalSchema = z.object({
  isActive: z.boolean(),
});
export type ToggleRecurringJournalDto = z.infer<
  typeof ToggleRecurringJournalSchema
>;

// =============================================
// Responses
// =============================================

export type RecurringJournalLineResponse = {
  id: string;
  templateId: string;
  accountId: string;
  account: { id: string; code: string; name: string } | null;
  description: string | null;
  debit: number;
  credit: number;
  sortOrder: number;
};

export type RecurringJournalResponse = {
  id: string;
  name: string;
  description: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  frequency: string;
  dayOfMonth: number | null;
  nextRunDate: string;
  lastRunDate: string | null;
  isActive: boolean;
  companyId: string;
  createdBy: string;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecurringJournalDetailResponse = RecurringJournalResponse & {
  lines: RecurringJournalLineResponse[];
};

// Replaced by PaginatedResponse<RecurringJournalResponse> from @/common/types/response

export type RunRecurringJournalResponse = {
  template: RecurringJournalResponse;
  journalId: string;
  entryNumber: string;
};
