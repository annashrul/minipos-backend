import { z } from "zod";

export const StockTransferStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "REJECTED",
]);
export type StockTransferStatusDto = z.infer<typeof StockTransferStatusSchema>;

export const ListStockTransfersQuerySchema = z.object({
  search: z.string().optional(),
  status: StockTransferStatusSchema.optional(),
  branchId: z.string().optional(),
  fromBranchId: z.string().optional(),
  toBranchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListStockTransfersQueryDto = z.infer<
  typeof ListStockTransfersQuerySchema
>;

export const StockTransferItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type StockTransferItemInputDto = z.infer<
  typeof StockTransferItemInputSchema
>;

export const CreateStockTransferSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  notes: z.string().nullable().optional(),
  items: z.array(StockTransferItemInputSchema).min(1),
});
export type CreateStockTransferDto = z.infer<typeof CreateStockTransferSchema>;

export const ReceiveStockTransferItemSchema = z.object({
  productId: z.string().min(1),
  receivedQuantity: z.number().int().min(0),
});
export type ReceiveStockTransferItemDto = z.infer<
  typeof ReceiveStockTransferItemSchema
>;

export const ReceiveStockTransferSchema = z.object({
  notes: z.string().nullable().optional(),
  items: z.array(ReceiveStockTransferItemSchema).min(1),
});
export type ReceiveStockTransferDto = z.infer<
  typeof ReceiveStockTransferSchema
>;

export type StockTransferItemResponse = {
  id: string;
  stockTransferId: string;
  productId: string;
  productName: string;
  product: { id: string; code: string; name: string } | null;
  quantity: number;
  receivedQty: number;
  createdAt: string;
};

export type StockTransferResponse = {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  fromBranch: { id: string; name: string } | null;
  toBranchId: string;
  toBranch: { id: string; name: string } | null;
  status: StockTransferStatusDto;
  notes: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  requestedAt: string;
  approvedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type StockTransferDetailResponse = StockTransferResponse & {
  items: StockTransferItemResponse[];
};

export type StockTransferListResponse = {
  transfers: StockTransferResponse[];
  total: number;
  totalPages: number;
};
