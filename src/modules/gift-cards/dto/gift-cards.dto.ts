import { z } from "zod";

export const ListGiftCardsQuerySchema = z.object({
  customerId: z.string().optional(),
  branchId: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum([
      "code",
      "initialBalance",
      "currentBalance",
      "status",
      "expiresAt",
      "createdAt",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListGiftCardsQueryDto = z.infer<typeof ListGiftCardsQuerySchema>;

export const CreateGiftCardSchema = z.object({
  initialBalance: z.number().positive(),
  customerId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  code: z.string().min(3).max(64).optional(),
});
export type CreateGiftCardDto = z.infer<typeof CreateGiftCardSchema>;

export const TopupGiftCardSchema = z.object({
  amount: z.number().positive(),
  reference: z.string().nullable().optional(),
});
export type TopupGiftCardDto = z.infer<typeof TopupGiftCardSchema>;

export const RedeemGiftCardSchema = z.object({
  amount: z.number().positive(),
  reference: z.string().nullable().optional(),
  transactionId: z.string().nullable().optional(),
});
export type RedeemGiftCardDto = z.infer<typeof RedeemGiftCardSchema>;

export const UpdateGiftCardSchema = z.object({
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateGiftCardDto = z.infer<typeof UpdateGiftCardSchema>;

export type GiftCardCustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
};

export type GiftCardBranchSummary = {
  id: string;
  name: string;
};

export type GiftCardTransactionResponse = {
  id: string;
  giftCardId: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string | null;
  createdAt: string;
};

export type GiftCardResponse = {
  id: string;
  code: string;
  initialBalance: number;
  balance: number;
  status: string;
  isActive: boolean;
  customerId: string | null;
  customer: GiftCardCustomerSummary | null;
  branchId: string | null;
  branch: GiftCardBranchSummary | null;
  companyId: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type GiftCardDetailResponse = GiftCardResponse & {
  transactions: GiftCardTransactionResponse[];
};

export type GiftCardListResponse = {
  giftCards: GiftCardResponse[];
  total: number;
  totalPages: number;
};
