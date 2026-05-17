import { z } from "zod";

export const ListRacksQuerySchema = z.object({
  search: z.string().optional(),
  branchId: z.string().uuid().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRacksQueryDto = z.infer<typeof ListRacksQuerySchema>;

export const CreateRackSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});
export type CreateRackDto = z.infer<typeof CreateRackSchema>;

export const UpdateRackSchema = CreateRackSchema.partial().omit({
  branchId: true,
});
export type UpdateRackDto = z.infer<typeof UpdateRackSchema>;

export type RackResponse = {
  id: string;
  branchId: string;
  branchName: string;
  code: string;
  name: string;
  location: string | null;
  notes: string | null;
  isActive: boolean;
  productCount: number;
  totalQty: number;
  createdAt: string;
  updatedAt: string;
};

export type RackListResponse = {
  racks: RackResponse[];
  total: number;
  totalPages: number;
};

export type RackStockItem = {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  qty: number;
  imageUrl: string | null;
  isDefaultRack: boolean;
};

export type RackDetailResponse = RackResponse & {
  items: RackStockItem[];
};

export type ProductRackLocation = {
  rackId: string;
  rackCode: string;
  rackName: string;
  branchId: string;
  branchName: string;
  qty: number;
  isDefault: boolean;
};

export type ProductRackLookupResponse = {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  locations: ProductRackLocation[];
  totalQty: number;
};
