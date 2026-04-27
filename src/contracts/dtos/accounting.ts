import { z } from "zod";

// =============================================
// Enums
// =============================================

export const AccountTypeSchema = z.enum([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);
export type AccountTypeDto = z.infer<typeof AccountTypeSchema>;

export const NormalBalanceSchema = z.enum(["DEBIT", "CREDIT"]);
export type NormalBalanceDto = z.infer<typeof NormalBalanceSchema>;

export const JournalStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "POSTED",
  "VOIDED",
]);
export type JournalStatusDto = z.infer<typeof JournalStatusSchema>;

// =============================================
// Account Categories
// =============================================

export const ListAccountCategoriesQuerySchema = z.object({
  search: z.string().optional(),
  type: AccountTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListAccountCategoriesQueryDto = z.infer<
  typeof ListAccountCategoriesQuerySchema
>;

export const CreateAccountCategorySchema = z.object({
  name: z.string().min(1),
  type: AccountTypeSchema,
  normalSide: NormalBalanceSchema,
  sortOrder: z.coerce.number().int().min(0).optional(),
});
export type CreateAccountCategoryDto = z.infer<
  typeof CreateAccountCategorySchema
>;

export const UpdateAccountCategorySchema =
  CreateAccountCategorySchema.partial();
export type UpdateAccountCategoryDto = z.infer<
  typeof UpdateAccountCategorySchema
>;

export type AccountCategoryResponse = {
  id: string;
  name: string;
  type: string;
  normalSide: string;
  sortOrder: number;
  accountCount: number;
  createdAt: string;
};

export type AccountCategoryListResponse = {
  categories: AccountCategoryResponse[];
  total: number;
  totalPages: number;
};

// =============================================
// Accounts (COA)
// =============================================

export const ListAccountsQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  type: AccountTypeSchema.optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListAccountsQueryDto = z.infer<typeof ListAccountsQuerySchema>;

export const CreateAccountSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  categoryId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  openingBalance: z.coerce.number().optional(),
});
export type CreateAccountDto = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = CreateAccountSchema.partial();
export type UpdateAccountDto = z.infer<typeof UpdateAccountSchema>;

export type AccountResponse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string;
  category: {
    id: string;
    name: string;
    type: string;
    normalSide: string;
  } | null;
  parentId: string | null;
  parent: { id: string; name: string; code: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  isActive: boolean;
  isSystem: boolean;
  openingBalance: number;
  childrenCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AccountWithBalanceResponse = AccountResponse & {
  balance: number;
};

export type AccountListResponse = {
  accounts: AccountResponse[];
  total: number;
  totalPages: number;
};

export type AccountTreeNode = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  parentId: string | null;
  isActive: boolean;
  normalSide: string;
  children: AccountTreeNode[];
};

export type AccountTreeResponse = {
  tree: AccountTreeNode[];
};

// =============================================
// Journals
// =============================================

export const ListJournalsQuerySchema = z.object({
  search: z.string().optional(),
  status: JournalStatusSchema.optional(),
  branchId: z.string().nullable().optional(),
  referenceType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListJournalsQueryDto = z.infer<typeof ListJournalsQuerySchema>;

export const JournalLineInputSchema = z
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
export type JournalLineInputDto = z.infer<typeof JournalLineInputSchema>;

export const CreateJournalSchema = z.object({
  date: z.string().datetime(),
  description: z.string().min(1),
  reference: z.string().nullable().optional(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(JournalLineInputSchema).min(2, "Minimal 2 baris jurnal"),
});
export type CreateJournalDto = z.infer<typeof CreateJournalSchema>;

export const UpdateJournalSchema = z.object({
  date: z.string().datetime().optional(),
  description: z.string().min(1).optional(),
  reference: z.string().nullable().optional(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(JournalLineInputSchema).min(2).optional(),
});
export type UpdateJournalDto = z.infer<typeof UpdateJournalSchema>;

export const VoidJournalSchema = z.object({
  voidReason: z.string().min(1),
});
export type VoidJournalDto = z.infer<typeof VoidJournalSchema>;

export type JournalLineResponse = {
  id: string;
  journalId: string;
  accountId: string;
  account: { id: string; code: string; name: string } | null;
  description: string | null;
  debit: number;
  credit: number;
  sortOrder: number;
};

export type JournalResponse = {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  reference: string | null;
  referenceType: string | null;
  referenceId: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  periodId: string | null;
  status: string;
  totalDebit: number;
  totalCredit: number;
  notes: string | null;
  rejectionNote: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedBy: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type JournalDetailResponse = JournalResponse & {
  lines: JournalLineResponse[];
};

export type JournalListResponse = {
  journals: JournalResponse[];
  total: number;
  totalPages: number;
};
