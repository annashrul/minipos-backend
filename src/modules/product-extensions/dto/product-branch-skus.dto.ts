import { z } from "zod";

// ProductBranchSku — single source of truth untuk inventory:
// Cabang × Satuan × Varian → harga + stok per leaf cell.

export const ProductBranchSkuInputSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().min(1),
  unitId: z.string().nullable().optional(),
  // Frontend boleh kirim variantId langsung ATAU optionIds[]. Kalau optionIds
  // ada, backend auto-find-or-create ProductVariant matching exact set.
  variantId: z.string().nullable().optional(),
  optionIds: z.array(z.string()).optional(),
  sellingPrice: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative(),
  stock: z.number().int().min(0).optional().default(0),
  minStock: z.number().int().min(0).optional().default(5),
  barcode: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
export type ProductBranchSkuInputDto = z.infer<
  typeof ProductBranchSkuInputSchema
>;

export const ReplaceProductBranchSkusSchema = z.object({
  items: z.array(ProductBranchSkuInputSchema),
});
export type ReplaceProductBranchSkusDto = z.infer<
  typeof ReplaceProductBranchSkusSchema
>;

export type ProductBranchSkuResponse = {
  id: string;
  productId: string;
  branchId: string;
  unitId: string | null;
  variantId: string | null;
  sellingPrice: number;
  purchasePrice: number;
  stock: number;
  minStock: number;
  barcode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductBranchSkuListResponse = {
  skus: ProductBranchSkuResponse[];
};
