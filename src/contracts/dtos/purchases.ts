import { z } from "zod";

export const PurchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "ORDERED",
  "PARTIAL",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
]);
export type PurchaseOrderStatusDto = z.infer<typeof PurchaseOrderStatusSchema>;

export const ListPurchasesQuerySchema = z.object({
  search: z.string().optional(),
  status: PurchaseOrderStatusSchema.optional(),
  supplierId: z.string().optional(),
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListPurchasesQueryDto = z.infer<typeof ListPurchasesQuerySchema>;

export const PurchaseOrderItemInputSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  productCode: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
  // Optional — di-set saat user pilih SKU spesifik dari ProductSkuChooser
  // (produk multi-satuan / multi-varian). Backend simpan ke kolom item.
  unitId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
});
export type PurchaseOrderItemInputDto = z.infer<
  typeof PurchaseOrderItemInputSchema
>;

export const CreatePurchaseSchema = z.object({
  supplierId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  items: z.array(PurchaseOrderItemInputSchema).min(1),
  expectedDate: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreatePurchaseDto = z.infer<typeof CreatePurchaseSchema>;

export const UpdatePurchaseSchema = z.object({
  supplierId: z.string().min(1).optional(),
  branchId: z.string().nullable().optional(),
  items: z.array(PurchaseOrderItemInputSchema).min(1).optional(),
  expectedDate: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdatePurchaseDto = z.infer<typeof UpdatePurchaseSchema>;

export const UpdatePurchaseStatusSchema = z.object({
  status: PurchaseOrderStatusSchema,
});
export type UpdatePurchaseStatusDto = z.infer<
  typeof UpdatePurchaseStatusSchema
>;

export const ReceivePurchaseItemSchema = z.object({
  // Identifikasi item PO yg sedang diterima. Pakai purchaseOrderItemId
  // wajib supaya untuk produk multi-varian (1 productId = N PO items),
  // backend bisa nge-match ke PO item yg tepat (variantId+unitId).
  // productId masih diterima sebagai fallback untuk PO lama.
  purchaseOrderItemId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  quantityReceived: z.number().int().positive(),
  unitCost: z.number().nonnegative().optional(),
  notes: z.string().nullable().optional(),
}).refine((v) => !!v.purchaseOrderItemId || !!v.productId, {
  message: "purchaseOrderItemId atau productId wajib diisi",
});
export type ReceivePurchaseItemDto = z.infer<typeof ReceivePurchaseItemSchema>;

export const ReceivePurchaseSchema = z.object({
  branchId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(ReceivePurchaseItemSchema).min(1),
  // Payment + debt tracking on receipt
  paidAmount: z.number().nonnegative().nullable().optional(),
  debtDueDate: z.string().datetime().nullable().optional(),
});
export type ReceivePurchaseDto = z.infer<typeof ReceivePurchaseSchema>;

export const ClosePurchaseDiscrepancySchema = z.object({
  itemId: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().nullable().optional(),
});
export type ClosePurchaseDiscrepancyDto = z.infer<
  typeof ClosePurchaseDiscrepancySchema
>;

export const ClosePurchaseSchema = z.object({
  discrepancyNote: z.string().nullable().optional(),
  // When true, automatically reduce/cancel any related supplier debt to
  // match the actual received amount.
  adjustDebt: z.boolean().optional().default(false),
  discrepancies: z.array(ClosePurchaseDiscrepancySchema).optional(),
});
export type ClosePurchaseDto = z.infer<typeof ClosePurchaseSchema>;

export type ClosePurchaseResponse = {
  purchaseOrder: PurchaseOrderDetailResponse;
  debtAdjusted: boolean;
  debtId: string | null;
  debtRemainingBefore: number | null;
  debtRemainingAfter: number | null;
};

// ===== Purchase Transaction Log (Laporan Pembelian) =====
export const ListPurchaseTransactionLogQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  documentType: z.string().optional(),
  branchId: z.string().optional(),
  // Filter ke PO spesifik — dipakai untuk modal history pergerakan.
  purchaseOrderId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPurchaseTransactionLogQueryDto = z.infer<
  typeof ListPurchaseTransactionLogQuerySchema
>;

export type PurchaseTransactionLogResponse = {
  id: string;
  purchaseOrderId: string;
  purchaseOrder: {
    id: string;
    orderNumber: string;
    purchaseTransactionNumber: string | null;
  } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  documentNumber: string;
  documentType: string;
  status: string;
  amount: number | null;
  note: string | null;
  createdBy: string | null;
  createdByUser: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  createdAt: string;
};

export type PurchaseTransactionLogListResponse = {
  logs: PurchaseTransactionLogResponse[];
  total: number;
  totalPages: number;
};

export type ReceivePurchaseResponse = {
  receipt: GoodsReceiptResponse;
  purchaseOrder: PurchaseOrderDetailResponse;
  debtId: string | null;
  debtRemaining: number | null;
};

export type PurchaseOrderItemResponse = {
  id: string;
  purchaseOrderId: string;
  productId: string;
  product: { id: string; code: string; name: string } | null;
  unitId: string | null;
  unitName: string | null;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  receivedQty: number;
  unitPrice: number;
  subtotal: number;
  // Harga beli master saat ini (diturunkan sesuai konteks: variant override >
  // unit > product). Frontend pakai utk preview perbandingan harga di dialog
  // terima.
  currentMasterPrice: number | null;
  // Snapshot harga master sebelum receive pertama. Null kalau belum pernah
  // diterima atau receipt lama sebelum fitur snapshot.
  previousPurchasePrice: number | null;
};

export type GoodsReceiptItemResponse = {
  id: string;
  goodsReceiptId: string;
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: number | null;
  previousPurchasePrice: number | null;
  notes: string | null;
};

export type GoodsReceiptResponse = {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  receivedBy: string | null;
  receivedByName: string | null;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  items: GoodsReceiptItemResponse[];
};

export type PurchaseOrderResponse = {
  id: string;
  orderNumber: string;
  purchaseTransactionNumber: string;
  supplierId: string;
  supplier: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  status: PurchaseOrderStatusDto;
  totalAmount: number;
  receivedAmount: number;
  paidAmount: number;
  notes: string | null;
  orderDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItemResponse[];
  receiptCount: number;
};

export type PurchaseOrderDetailResponse = PurchaseOrderResponse & {
  receipts: GoodsReceiptResponse[];
};

export type PurchaseListResponse = {
  purchases: PurchaseOrderResponse[];
  total: number;
  totalPages: number;
};

export type PurchaseSummaryResponse = {
  totalCount: number;
  totalAmount: number;
  byStatus: Array<{
    status: PurchaseOrderStatusDto;
    count: number;
    totalAmount: number;
  }>;
};
