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
  // Empty string → backend will auto-generate (PRD-XXXXX).
  code: z.string().optional().default(""),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  brandId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  purchasePrice: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  stock: z.number().int().nonnegative().optional().default(0),
  minStock: z.number().int().nonnegative().optional().default(5),
  barcode: z.string().nullable().optional(),
  unit: z.string().optional().default("pcs"),
  itemType: ProductItemTypeSchema.optional(),
  isActive: z.boolean().optional().default(true),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  // Optional: replace product↔modifier-group attachments in the same request.
  modifierGroupIds: z.array(z.string().min(1)).optional(),
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
};

export type ProductListResponse = {
  products: ProductResponse[];
  total: number;
  totalPages: number;
};
