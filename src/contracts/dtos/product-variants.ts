import { z } from "zod";

// Variant CRUD — diisi per produk (relative ke productId di URL).
// Set optionIds menentukan kombinasi unik (mis. {Hitam, XL}). Tidak boleh
// duplicate per variant — backend validasi.

export const ProductVariantInputSchema = z.object({
  id: z.string().optional(),
  optionIds: z.array(z.string().min(1)).min(1),
  priceOverride: z.number().nullable().optional(),
  purchasePriceOverride: z.number().nullable().optional(),
  stock: z.number().int().min(0).optional().default(0),
  barcode: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
export type ProductVariantInputDto = z.infer<typeof ProductVariantInputSchema>;

export const ReplaceProductVariantsSchema = z.object({
  items: z.array(ProductVariantInputSchema),
});
export type ReplaceProductVariantsDto = z.infer<
  typeof ReplaceProductVariantsSchema
>;

export type ProductVariantResponse = {
  id: string;
  productId: string;
  priceOverride: number | null;
  purchasePriceOverride: number | null;
  stock: number;
  barcode: string | null;
  isActive: boolean;
  optionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProductVariantListResponse = {
  variants: ProductVariantResponse[];
};
