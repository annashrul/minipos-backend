import { z } from "zod";

export const ListCategoriesQuerySchema = z.object({
  search: z.string().optional(),
  parentId: z.string().nullable().optional(),
  kind: z.enum(["PRODUCT", "VEHICLE_MODEL"]).optional(),
  brandId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(["name", "products", "createdAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListCategoriesQueryDto = z.infer<typeof ListCategoriesQuerySchema>;

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  kind: z.enum(["PRODUCT", "VEHICLE_MODEL"]).optional(),
  brandId: z.string().nullable().optional(),
});
export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = CreateCategorySchema.partial();
export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;

export type CategoryResponse = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  kind: string;
  brandId: string | null;
  brand: { id: string; name: string } | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CategoryListResponse = {
  categories: CategoryResponse[];
  total: number;
  totalPages: number;
};
