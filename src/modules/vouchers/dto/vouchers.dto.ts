import { z } from "zod";

export const ListVouchersQuerySchema = z.object({
  promotionId: z.string().optional(),
  isUsed: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListVouchersQueryDto = z.infer<typeof ListVouchersQuerySchema>;

export const GenerateVouchersSchema = z.object({
  promotionId: z.string().min(1),
  count: z.number().int().min(1).max(10_000),
  prefix: z.string().min(1).max(16).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type GenerateVouchersDto = z.infer<typeof GenerateVouchersSchema>;

export const RedeemVoucherSchema = z.object({
  usedBy: z.string().nullable().optional(),
});
export type RedeemVoucherDto = z.infer<typeof RedeemVoucherSchema>;

export type VoucherPromotionSummary = {
  id: string;
  name: string;
  type: string;
  value: number;
  voucherCode: string | null;
  isActive: boolean;
};

export type VoucherResponse = {
  id: string;
  code: string;
  promotionId: string;
  promotion: VoucherPromotionSummary | null;
  isUsed: boolean;
  usedBy: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type VoucherListResponse = {
  vouchers: VoucherResponse[];
  total: number;
  totalPages: number;
};

export type VoucherGenerateResponse = {
  created: number;
  codes: string[];
};
