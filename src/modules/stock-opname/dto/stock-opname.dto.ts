import { z } from "zod";

export const StockOpnameStatusSchema = z.enum([
  "DRAFT",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export type StockOpnameStatusDto = z.infer<typeof StockOpnameStatusSchema>;

export const ListStockOpnameQuerySchema = z.object({
  search: z.string().optional(),
  status: StockOpnameStatusSchema.optional(),
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListStockOpnameQueryDto = z.infer<
  typeof ListStockOpnameQuerySchema
>;

export const CreateStockOpnameSchema = z.object({
  branchId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateStockOpnameDto = z.infer<typeof CreateStockOpnameSchema>;

export const OpnameItemInputSchema = z.object({
  productId: z.string().min(1),
  physicalStock: z.number().int().min(0),
  notes: z.string().nullable().optional(),
});
export type OpnameItemInputDto = z.infer<typeof OpnameItemInputSchema>;

export const SetOpnameItemsSchema = z.object({
  items: z.array(OpnameItemInputSchema).min(1),
});
export type SetOpnameItemsDto = z.infer<typeof SetOpnameItemsSchema>;

export type StockOpnameItemResponse = {
  id: string;
  stockOpnameId: string;
  productId: string;
  product: { id: string; code: string; name: string } | null;
  systemStock: number;
  physicalStock: number;
  difference: number;
  notes: string | null;
  createdAt: string;
};

export type StockOpnameResponse = {
  id: string;
  opnameNumber: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  status: StockOpnameStatusDto;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type StockOpnameDetailResponse = StockOpnameResponse & {
  items: StockOpnameItemResponse[];
};

export type StockOpnameListResponse = {
  opnames: StockOpnameResponse[];
  total: number;
  totalPages: number;
};
