import { z } from "zod";

// Tipe item:
// - PRODUCT     : barang fisik yg dijual (default; semua bisnis unit pakai)
// - SERVICE     : jasa, tanpa stock validation (bengkel, dll)
// - INGREDIENT  : bahan baku F&B (beras, telur, dll). Di-stock seperti PRODUCT
//                 tapi tidak tampil di POS — hanya dipakai sbg ingredient di
//                 Recipe / BOM. Khusus business unit RESTAURANT / CAFE.
export const ProductItemTypeSchema = z.enum([
  "PRODUCT",
  "SERVICE",
  "INGREDIENT",
]);
export type ProductItemType = z.infer<typeof ProductItemTypeSchema>;

export const ListProductsQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  supplierId: z.string().optional(),
  itemType: ProductItemTypeSchema.optional(),
  // Untuk POS / cashier: exclude bahan baku yg tidak dijual langsung.
  excludeIngredient: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z
    .enum([
      "name",
      "code",
      "category",
      "purchasePrice",
      "sellingPrice",
      "stock",
      "createdAt",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListProductsQueryDto = z.infer<typeof ListProductsQuerySchema>;

export const CreateProductSchema = z.object({
  // Empty string atau undefined → backend akan auto-generate (PRD-XXXXX).
  // TIDAK pakai .default("") karena akan apply juga ke partial() di
  // UpdateProductSchema, bikin PATCH tanpa `code` field reset jadi "".
  code: z.string().optional(),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  brandId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  purchasePrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  // SEMUA field di bawah TIDAK boleh pakai .default() — akan apply ke
  // UpdateProductSchema (.partial()) dan bikin PATCH tanpa field reset
  // value DB ke default. Default value di-handle di service layer via
  // `?? defaultValue` sebelum prisma.create.
  stock: z.number().int().nonnegative().optional(),
  minStock: z.number().int().nonnegative().optional(),
  barcode: z.string().nullable().optional(),
  unit: z.string().optional(),
  itemType: ProductItemTypeSchema.optional(),
  isActive: z.boolean().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  // Optional: replace product↔modifier-group attachments in the same request.
  modifierGroupIds: z.array(z.string().min(1)).optional(),
  // Optional: replace ProductUnit (delete-all + create-from-payload) inline.
  productUnits: z
    .array(
      z.object({
        name: z.string().min(1),
        conversionQty: z.number().int().min(1),
        sellingPrice: z.number().nonnegative().optional(),
        purchasePrice: z.number().nonnegative().nullable().optional(),
        barcode: z.string().nullable().optional(),
      }),
    )
    .optional(),
  // Optional: replace ProductTierPrice inline.
  tierPrices: z
    .array(
      z.object({
        minQty: z.number().int().min(1),
        price: z.number().nonnegative(),
      }),
    )
    .optional(),
  // Optional: replace ProductBranchSku inline. unitName dipakai resolution
  // di backend → unitId, supaya frontend tidak perlu kirim unit IDs yg masih
  // stale di mode create. optionIds untuk find-or-create variant.
  branchSkus: z
    .array(
      z.object({
        branchId: z.string().min(1),
        unitName: z.string().nullable().optional(),
        optionIds: z.array(z.string()).optional(),
        sellingPrice: z.number().nonnegative(),
        purchasePrice: z.number().nonnegative(),
        stock: z.number().int().nonnegative().optional(),
        minStock: z.number().int().nonnegative().optional(),
        barcode: z.string().nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type CreateProductDto = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.partial();
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;

export type ProductResponse = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: { id: string; name: string } | null;
  brandId: string | null;
  brand: { id: string; name: string } | null;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  barcode: string | null;
  unit: string;
  itemType: ProductItemType;
  isActive: boolean;
  description: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  /** Jumlah ProductUnit (satuan tambahan). 0 / 1 = single-unit, >1 = multi-unit. */
  unitCount: number;
  /** Jumlah ProductVariant. 0 = no variant, >0 = punya variant. */
  variantCount: number;
};

export type ProductListResponse = {
  products: ProductResponse[];
  total: number;
  totalPages: number;
};
