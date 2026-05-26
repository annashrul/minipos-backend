import { z } from "zod";

// ============================================================
// PRODUCT UNITS
// ============================================================

export const CreateProductUnitSchema = z.object({
  name: z.string().min(1),
  conversionQty: z.number().int().min(1),
  sellingPrice: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  barcode: z.string().nullable().optional(),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
});
export type CreateProductUnitDto = z.infer<typeof CreateProductUnitSchema>;

export const UpdateProductUnitSchema = z.object({
  name: z.string().min(1).optional(),
  conversionQty: z.number().int().min(1).optional(),
  sellingPrice: z.number().nonnegative().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  barcode: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateProductUnitDto = z.infer<typeof UpdateProductUnitSchema>;

export type ProductUnitResponse = {
  id: string;
  productId: string;
  name: string;
  conversionQty: number;
  sellingPrice: number;
  purchasePrice: number | null;
  barcode: string | null;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

// ============================================================
// PRODUCT TIER PRICES
// ============================================================

export const CreateTierPriceSchema = z.object({
  minQty: z.number().int().min(1),
  price: z.number().nonnegative(),
});
export type CreateTierPriceDto = z.infer<typeof CreateTierPriceSchema>;

export const UpdateTierPriceSchema = z.object({
  minQty: z.number().int().min(1).optional(),
  price: z.number().nonnegative().optional(),
});
export type UpdateTierPriceDto = z.infer<typeof UpdateTierPriceSchema>;

export const ReplaceTierPricesSchema = z.object({
  items: z.array(
    z.object({
      minQty: z.number().int().min(1),
      price: z.number().nonnegative(),
    }),
  ),
});
export type ReplaceTierPricesDto = z.infer<typeof ReplaceTierPricesSchema>;

export type TierPriceResponse = {
  id: string;
  productId: string;
  minQty: number;
  price: number;
  createdAt: string;
  updatedAt: string;
};

// ============================================================
// BRANCH PRODUCT PRICES
// ============================================================

export const ListBranchPricesQuerySchema = z.object({
  branchId: z.string().optional(),
  productId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBranchPricesQueryDto = z.infer<
  typeof ListBranchPricesQuerySchema
>;

export const CreateBranchPriceSchema = z.object({
  branchId: z.string().min(1),
  sellingPrice: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
});
export type CreateBranchPriceDto = z.infer<typeof CreateBranchPriceSchema>;

export const UpdateBranchPriceSchema = z.object({
  sellingPrice: z.number().nonnegative().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
});
export type UpdateBranchPriceDto = z.infer<typeof UpdateBranchPriceSchema>;

export const ReplaceBranchPricesSchema = z.object({
  items: z.array(
    z.object({
      branchId: z.string().min(1),
      sellingPrice: z.number().nonnegative(),
      purchasePrice: z.number().nonnegative().nullable().optional(),
    }),
  ),
});
export type ReplaceBranchPricesDto = z.infer<typeof ReplaceBranchPricesSchema>;

export type BranchPriceResponse = {
  id: string;
  branchId: string;
  productId: string;
  sellingPrice: number;
  purchasePrice: number | null;
  branch: { id: string; name: string; code: string | null } | null;
  product: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type BranchPriceListResponse = {
  items: BranchPriceResponse[];
  total: number;
  totalPages: number;
};
