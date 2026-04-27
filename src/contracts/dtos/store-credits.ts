import { z } from "zod";

export const ListStoreCreditsQuerySchema = z.object({
  customerId: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListStoreCreditsQueryDto = z.infer<
  typeof ListStoreCreditsQuerySchema
>;

export const CreateStoreCreditSchema = z.object({
  customerId: z.string().min(1),
  initialAmount: z.number().positive(),
  // `source` is accepted for future use; the DB model has no column yet, so it
  // is ignored on the server side. Kept here so the FE form can pass it.
  source: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  code: z.string().min(3).max(64).optional(),
});
export type CreateStoreCreditDto = z.infer<typeof CreateStoreCreditSchema>;

export const UseStoreCreditSchema = z.object({
  amount: z.number().positive(),
  transactionId: z.string().nullable().optional(),
});
export type UseStoreCreditDto = z.infer<typeof UseStoreCreditSchema>;

export const UpdateStoreCreditSchema = z.object({
  isActive: z.boolean(),
});
export type UpdateStoreCreditDto = z.infer<typeof UpdateStoreCreditSchema>;

export type StoreCreditCustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
};

export type StoreCreditUsageResponse = {
  id: string;
  storeCreditId: string;
  amount: number;
  transactionId: string | null;
  notes: string | null;
  createdAt: string;
};

export type StoreCreditResponse = {
  id: string;
  code: string;
  customerId: string;
  customer: StoreCreditCustomerSummary | null;
  balance: number;
  initialAmount: number;
  source: string | null;
  isActive: boolean;
  expiresAt: string | null;
  issuedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreCreditDetailResponse = StoreCreditResponse & {
  usages: StoreCreditUsageResponse[];
};

export type StoreCreditListResponse = {
  storeCredits: StoreCreditResponse[];
  total: number;
  totalPages: number;
};

export type StoreCreditCustomerTotalResponse = {
  customerId: string;
  total: number;
  count: number;
};
