import { z } from "zod";

export const ListBrandsQuerySchema = z.object({
  search: z.string().optional(),
  kind: z.enum(["PRODUCT", "VEHICLE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(["name", "products", "createdAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListBrandsQueryDto = z.infer<typeof ListBrandsQuerySchema>;

export const CreateBrandSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["PRODUCT", "VEHICLE"]).optional(),
});
export type CreateBrandDto = z.infer<typeof CreateBrandSchema>;

export const UpdateBrandSchema = CreateBrandSchema.partial();
export type UpdateBrandDto = z.infer<typeof UpdateBrandSchema>;

export type BrandResponse = {
  id: string;
  name: string;
  kind: string;
  productCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BrandListResponse = {
  brands: BrandResponse[];
  total: number;
  totalPages: number;
};
