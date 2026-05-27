import { z } from "zod";

// =============================================
// Enums
// =============================================

export const BankReconciliationStatusSchema = z.enum([
  "IN_PROGRESS",
  "COMPLETED",
]);
export type BankReconciliationStatusDto = z.infer<
  typeof BankReconciliationStatusSchema
>;

export const BankReconciliationItemSourceSchema = z.enum([
  "BANK_STATEMENT",
  "JOURNAL",
]);
export type BankReconciliationItemSourceDto = z.infer<
  typeof BankReconciliationItemSourceSchema
>;

export const BankReconciliationItemMatchStatusSchema = z.enum([
  "UNMATCHED",
  "MATCHED",
  "ADJUSTED",
]);
export type BankReconciliationItemMatchStatusDto = z.infer<
  typeof BankReconciliationItemMatchStatusSchema
>;

// =============================================
// Queries
// =============================================

export const ListBankReconciliationsQuerySchema = z.object({
  accountId: z.string().optional(),
  status: BankReconciliationStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListBankReconciliationsQueryDto = z.infer<
  typeof ListBankReconciliationsQuerySchema
>;

// =============================================
// Mutations
// =============================================

export const CreateBankReconciliationSchema = z.object({
  accountId: z.string().min(1),
  statementDate: z.string().datetime(),
  statementBalance: z.coerce.number(),
});
export type CreateBankReconciliationDto = z.infer<
  typeof CreateBankReconciliationSchema
>;

export const UpdateBankReconciliationSchema = z.object({
  statementDate: z.string().datetime().optional(),
  statementBalance: z.coerce.number().optional(),
});
export type UpdateBankReconciliationDto = z.infer<
  typeof UpdateBankReconciliationSchema
>;

export const BankReconciliationItemInputSchema = z.object({
  source: BankReconciliationItemSourceSchema,
  referenceNumber: z.string().nullable().optional(),
  description: z.string().min(1),
  date: z.string().datetime(),
  amount: z.coerce.number(),
  matchedItemId: z.string().nullable().optional(),
  matchStatus: BankReconciliationItemMatchStatusSchema.optional(),
  journalEntryId: z.string().nullable().optional(),
});
export type BankReconciliationItemInputDto = z.infer<
  typeof BankReconciliationItemInputSchema
>;

export const SetReconciliationItemsSchema = z.object({
  items: z.array(BankReconciliationItemInputSchema),
});
export type SetReconciliationItemsDto = z.infer<
  typeof SetReconciliationItemsSchema
>;

export const ToggleItemMatchSchema = z.object({
  matchStatus: BankReconciliationItemMatchStatusSchema,
  matchedItemId: z.string().nullable().optional(),
});
export type ToggleItemMatchDto = z.infer<typeof ToggleItemMatchSchema>;

// =============================================
// Responses
// =============================================

export type BankReconciliationItemResponse = {
  id: string;
  reconciliationId: string;
  source: string;
  referenceNumber: string | null;
  description: string;
  date: string;
  amount: number;
  matchedItemId: string | null;
  matchStatus: string;
  journalEntryId: string | null;
  createdAt: string;
};

export type BankReconciliationResponse = {
  id: string;
  accountId: string;
  account: { id: string; code: string; name: string } | null;
  statementDate: string;
  statementBalance: number;
  bookBalance: number;
  status: string;
  companyId: string;
  completedBy: string | null;
  completedAt: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BankReconciliationDetailResponse = BankReconciliationResponse & {
  items: BankReconciliationItemResponse[];
};

// BankReconciliationListResponse removed — use PaginatedResponse<BankReconciliationResponse> instead
