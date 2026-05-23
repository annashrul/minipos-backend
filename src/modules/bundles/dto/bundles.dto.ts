import { z } from "zod";

export const ListBundlesQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  branchId: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z
    .enum([
      "code",
      "name",
      "sellingPrice",
      "totalBasePrice",
      "createdAt",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListBundlesQueryDto = z.infer<typeof ListBundlesQuerySchema>;

export const BundleItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  sortOrder: z.number().int().optional().default(0),
});
export type BundleItemInputDto = z.infer<typeof BundleItemInputSchema>;

export const CreateBundleSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  sellingPrice: z.number().nonnegative(),
  categoryId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  items: z.array(BundleItemInputSchema).min(1),
});
export type CreateBundleDto = z.infer<typeof CreateBundleSchema>;

export const UpdateBundleSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  sellingPrice: z.number().nonnegative().optional(),
  categoryId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  items: z.array(BundleItemInputSchema).min(1).optional(),
});
export type UpdateBundleDto = z.infer<typeof UpdateBundleSchema>;

export type BundleItemResponse = {
  id: string;
  productId: string;
  product: {
    id: string;
    code: string;
    name: string;
    sellingPrice: number;
    purchasePrice: number;
  } | null;
  quantity: number;
  sortOrder: number;
};

export type BundleResponse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sellingPrice: number;
  totalBasePrice: number;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  barcode: string | null;
  isActive: boolean;
  items: BundleItemResponse[];
  createdAt: string;
  updatedAt: string;
};

export type BundleListResponse = {
  bundles: BundleResponse[];
  total: number;
  totalPages: number;
};
