import { z } from "zod";

export const ListSuppliersQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z
    .enum(["name", "contact", "email", "products", "isActive", "createdAt"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListSuppliersQueryDto = z.infer<typeof ListSuppliersQuerySchema>;

export const CreateSupplierSchema = z.object({
  name: z.string().min(1),
  contact: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;

export const UpdateSupplierSchema = CreateSupplierSchema.partial();
export type UpdateSupplierDto = z.infer<typeof UpdateSupplierSchema>;

export type SupplierResponse = {
  id: string;
  name: string;
  contact: string | null;
  address: string | null;
  email: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SupplierListResponse = {
  suppliers: SupplierResponse[];
  total: number;
  totalPages: number;
};
