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

// Phase 2A: manual entry RackStock
export const SetRackStockItemSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().min(0),
});

export const SetRackStockSchema = z.object({
  items: z.array(SetRackStockItemSchema).min(1),
  notes: z.string().nullable().optional(),
});
export type SetRackStockDto = z.infer<typeof SetRackStockSchema>;

export const TransferRackStockSchema = z.object({
  fromRackId: z.string().uuid(),
  toRackId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().min(1),
      }),
    )
    .min(1),
  notes: z.string().nullable().optional(),
});
export type TransferRackStockDto = z.infer<typeof TransferRackStockSchema>;

export const AssignProductsToRackSchema = z.object({
  productIds: z.array(z.string().uuid()),
});
export type AssignProductsToRackDto = z.infer<typeof AssignProductsToRackSchema>;

export const ListRackMovementsQuerySchema = z.object({
  rackId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  type: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRackMovementsQueryDto = z.infer<
  typeof ListRackMovementsQuerySchema
>;

export type RackStockMovementResponse = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  branchId: string;
  branchName: string;
  fromRackId: string | null;
  fromRackCode: string | null;
  toRackId: string | null;
  toRackCode: string | null;
  qty: number;
  type: string;
  refType: string | null;
  refId: string | null;
  notes: string | null;
  byUserId: string | null;
  byUserName: string | null;
  createdAt: string;
};

export type RackMovementListResponse = {
  movements: RackStockMovementResponse[];
  total: number;
  totalPages: number;
};

export const ReportDiscrepancySchema = z.object({
  rackId: z.string().uuid(),
  productId: z.string().uuid(),
  expectedQty: z.number().int().min(0),
  actualQty: z.number().int().min(0),
  notes: z.string().nullable().optional(),
});
export type ReportDiscrepancyDto = z.infer<typeof ReportDiscrepancySchema>;

export type DiscrepancyReportResponse = {
  id: string;
  rackId: string;
  rackCode: string;
  productId: string;
  productCode: string;
  productName: string;
  expectedQty: number;
  actualQty: number;
  difference: number;
  status: "OPEN" | "RESOLVED";
  notes: string | null;
  reportedByUserId: string;
  reportedByName: string;
  reportedAt: string;
  resolvedAt: string | null;
};

