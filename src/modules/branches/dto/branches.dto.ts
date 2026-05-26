import { z } from "zod";

export const ListBranchesQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBranchesQueryDto = z.infer<typeof ListBranchesQuerySchema>;

export const CreateBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial();
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;

export type BranchResponse = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  userCount: number;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BranchListResponse = {
  branches: BranchResponse[];
  total: number;
  totalPages: number;
};
