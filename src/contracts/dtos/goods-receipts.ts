import { z } from "zod";

export const ListGoodsReceiptsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  supplierId: z.string().optional(),
  branchId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(10),
});
export type ListGoodsReceiptsQueryDto = z.infer<
  typeof ListGoodsReceiptsQuerySchema
>;

export const GoodsReceiptStatsQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type GoodsReceiptStatsQueryDto = z.infer<
  typeof GoodsReceiptStatsQuerySchema
>;

export const BulkDeleteGoodsReceiptsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type BulkDeleteGoodsReceiptsDto = z.infer<
  typeof BulkDeleteGoodsReceiptsSchema
>;

export type GoodsReceiptListItemResponse = {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrder: {
    orderNumber: string;
    supplier: { name: string } | null;
    totalAmount: number;
    status: string;
  } | null;
  branch: { name: string } | null;
  receivedBy: string | null;
  receivedByName: string | null;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  itemsCount: number;
};

export type GoodsReceiptListResponse = {
  receipts: GoodsReceiptListItemResponse[];
  total: number;
  totalPages: number;
};

export type GoodsReceiptDetailItemResponse = {
  id: string;
  goodsReceiptId: string;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  notes: string | null;
};

export type GoodsReceiptDetailResponse = {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  purchaseOrder: {
    orderNumber: string;
    orderDate: string;
    status: string;
    totalAmount: number;
    supplier: {
      name: string;
      contact: string | null;
      address: string | null;
    } | null;
  } | null;
  branch: { name: string } | null;
  receivedBy: string | null;
  receivedByName: string | null;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  items: GoodsReceiptDetailItemResponse[];
};

export type GoodsReceiptStatsResponse = {
  total: number;
  today: number;
  thisMonth: number;
};
