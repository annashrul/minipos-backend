import { z } from "zod";

export const StockMovementTypeSchema = z.enum([
  "IN",
  "OUT",
  "ADJUSTMENT",
  "TRANSFER",
  "OPNAME",
]);
export type StockMovementTypeDto = z.infer<typeof StockMovementTypeSchema>;

export const ListStockMovementsQuerySchema = z.object({
  productId: z.string().optional(),
  branchId: z.string().optional(),
  type: StockMovementTypeSchema.optional(),
  reference: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListStockMovementsQueryDto = z.infer<
  typeof ListStockMovementsQuerySchema
>;

export type StockMovementResponse = {
  id: string;
  productId: string;
  product: { id: string; name: string; code: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  type: string;
  quantity: number;
  note: string | null;
  reference: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type StockMovementListResponse = {
  movements: StockMovementResponse[];
  total: number;
  totalPages: number;
};

export const AdjustStockSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  quantity: z.number().int().min(1),
  note: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
});
export type AdjustStockDto = z.infer<typeof AdjustStockSchema>;

export const ListBranchStockQuerySchema = z.object({
  branchId: z.string().min(1),
  search: z.string().optional(),
  lowStock: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBranchStockQueryDto = z.infer<typeof ListBranchStockQuerySchema>;

export type BranchStockResponse = {
  id: string;
  branchId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string } | null;
  quantity: number;
  minStock: number;
  updatedAt: string;
};

export type BranchStockListResponse = {
  stocks: BranchStockResponse[];
  total: number;
  totalPages: number;
};
