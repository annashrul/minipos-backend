import { z } from "zod";

export const ListProductsQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  supplierId: z.string().optional(),
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
  code: z.string().min(1),
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
  isActive: z.boolean().optional().default(true),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
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
