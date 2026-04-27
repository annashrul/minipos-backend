import { z } from "zod";

export const PromoTypeSchema = z.enum([
  "DISCOUNT_PERCENT",
  "DISCOUNT_AMOUNT",
  "BUY_X_GET_Y",
  "VOUCHER",
  "BUNDLE",
]);
export type PromoTypeDto = z.infer<typeof PromoTypeSchema>;

export const PromoScopeSchema = z.enum(["all", "product", "category"]);
export type PromoScopeDto = z.infer<typeof PromoScopeSchema>;

export const ListPromotionsQuerySchema = z.object({
  search: z.string().optional(),
  type: PromoTypeSchema.optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  scope: PromoScopeSchema.optional(),
  branchId: z.string().optional(),
  active: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListPromotionsQueryDto = z.infer<typeof ListPromotionsQuerySchema>;

export const CreatePromotionSchema = z
  .object({
    name: z.string().min(1),
    type: PromoTypeSchema,
    value: z.number().nonnegative(),
    minPurchase: z.number().nonnegative().nullable().optional(),
    maxDiscount: z.number().nonnegative().nullable().optional(),
    scope: PromoScopeSchema.optional().default("all"),
    categoryId: z.string().nullable().optional(),
    productId: z.string().nullable().optional(),
    branchId: z.string().nullable().optional(),
    buyQty: z.number().int().min(1).nullable().optional(),
    getQty: z.number().int().min(1).nullable().optional(),
    getProductId: z.string().nullable().optional(),
    voucherCode: z.string().nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    isActive: z.boolean().optional().default(true),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine((v) => new Date(v.endDate) >= new Date(v.startDate), {
    message: "endDate harus >= startDate",
    path: ["endDate"],
  })
  .refine((v) => v.scope !== "product" || !!v.productId, {
    message: "scope=product memerlukan productId",
    path: ["productId"],
  })
  .refine((v) => v.scope !== "category" || !!v.categoryId, {
    message: "scope=category memerlukan categoryId",
    path: ["categoryId"],
  })
  .refine(
    (v) =>
      v.type !== "BUY_X_GET_Y" || (v.buyQty != null && v.getQty != null),
    {
      message: "BUY_X_GET_Y memerlukan buyQty dan getQty",
      path: ["buyQty"],
    },
  )
  .refine((v) => v.type !== "VOUCHER" || !!v.voucherCode, {
    message: "VOUCHER memerlukan voucherCode",
    path: ["voucherCode"],
  });
export type CreatePromotionDto = z.infer<typeof CreatePromotionSchema>;

export const UpdatePromotionSchema = z.object({
  name: z.string().min(1).optional(),
  type: PromoTypeSchema.optional(),
  value: z.number().nonnegative().optional(),
  minPurchase: z.number().nonnegative().nullable().optional(),
  maxDiscount: z.number().nonnegative().nullable().optional(),
  scope: PromoScopeSchema.optional(),
  categoryId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  buyQty: z.number().int().min(1).nullable().optional(),
  getQty: z.number().int().min(1).nullable().optional(),
  getProductId: z.string().nullable().optional(),
  voucherCode: z.string().nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
export type UpdatePromotionDto = z.infer<typeof UpdatePromotionSchema>;

export const TogglePromotionSchema = z.object({
  isActive: z.boolean(),
});
export type TogglePromotionDto = z.infer<typeof TogglePromotionSchema>;

export type PromotionResponse = {
  id: string;
  name: string;
  type: string;
  value: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  scope: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  productId: string | null;
  product: { id: string; name: string; code: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  buyQty: number | null;
  getQty: number | null;
  getProductId: string | null;
  voucherCode: string | null;
  usageLimit: number | null;
  usageCount: number;
  description: string | null;
  isActive: boolean;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
};

export type PromotionListResponse = {
  promotions: PromotionResponse[];
  total: number;
  totalPages: number;
};
