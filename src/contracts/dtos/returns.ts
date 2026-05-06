import { z } from "zod";

export const ReturnTypeSchema = z.enum(["RETURN", "EXCHANGE"]);
export type ReturnTypeDto = z.infer<typeof ReturnTypeSchema>;

export const ReturnStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
]);
export type ReturnStatusDto = z.infer<typeof ReturnStatusSchema>;

export const RefundMethodSchema = z.enum(["CASH", "TRANSFER", "STORE_CREDIT"]);
export type RefundMethodDto = z.infer<typeof RefundMethodSchema>;

export const ListReturnsQuerySchema = z.object({
  search: z.string().optional(),
  type: ReturnTypeSchema.optional(),
  status: ReturnStatusSchema.optional(),
  customerId: z.string().optional(),
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum(["returnNumber", "totalRefund", "createdAt"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListReturnsQueryDto = z.infer<typeof ListReturnsQuerySchema>;

export const CreateReturnItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
  exchangeProductId: z.string().nullable().optional(),
  exchangeQuantity: z.number().int().min(1).nullable().optional(),
  exchangeUnitPrice: z.number().nonnegative().nullable().optional(),
  exchangeSubtotal: z.number().nonnegative().nullable().optional(),
});
export type CreateReturnItemDto = z.infer<typeof CreateReturnItemSchema>;

export const CreateReturnSchema = z.object({
  transactionId: z.string().min(1),
  type: ReturnTypeSchema,
  reason: z.string().min(1),
  items: z.array(CreateReturnItemSchema).min(1),
  refundMethod: RefundMethodSchema.nullable().optional(),
  branchId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateReturnDto = z.infer<typeof CreateReturnSchema>;

export const RejectReturnSchema = z.object({
  reason: z.string().nullable().optional(),
});
export type RejectReturnDto = z.infer<typeof RejectReturnSchema>;

export const SearchReturnTransactionQuerySchema = z.object({
  q: z.string().min(1, "Query wajib diisi"),
  branchId: z.string().optional(),
});
export type SearchReturnTransactionQueryDto = z.infer<
  typeof SearchReturnTransactionQuerySchema
>;

export type SearchReturnTransactionItem = {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
  unitName: string;
  unitPrice: number;
  discount: number;
  subtotal: number;
  returnedQty: number;
  availableQty: number;
};

export type SearchReturnTransactionResponse = {
  id: string;
  invoiceNumber: string;
  invoiceDisplayNumber?: string | null;
  userId: string;
  user: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  paymentAmount: number;
  changeAmount: number;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: SearchReturnTransactionItem[];
};

export const SearchExchangeProductsQuerySchema = z.object({
  q: z.string().min(1, "Query wajib diisi"),
  branchId: z.string().optional(),
});
export type SearchExchangeProductsQueryDto = z.infer<
  typeof SearchExchangeProductsQuerySchema
>;

export type SearchExchangeProductItem = {
  id: string;
  name: string;
  code: string;
  sellingPrice: number;
  stock: number;
  imageUrl: string | null;
  unit: string;
  availableStock: number;
};

export type SearchExchangeProductsResponse = {
  products: SearchExchangeProductItem[];
};

export type ReturnItemResponse = {
  id: string;
  productId: string;
  productName: string;
  product: { id: string; code: string; name: string } | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  reason: string | null;
  exchangeProductId: string | null;
  exchangeProduct: { id: string; code: string; name: string } | null;
  exchangeQuantity: number | null;
  exchangeUnitPrice: number | null;
  exchangeSubtotal: number | null;
  restocked: boolean;
};

export type ReturnResponse = {
  id: string;
  returnNumber: string;
  transactionId: string;
  transactionInvoice: string;
  customerId: string | null;
  customer: { id: string; name: string } | null;
  type: string;
  status: string;
  reason: string;
  notes: string | null;
  totalRefund: number;
  totalExchange: number;
  refundMethod: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  processedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ReturnDetailResponse = ReturnResponse & {
  items: ReturnItemResponse[];
};

export type ReturnListResponse = {
  returns: ReturnResponse[];
  total: number;
  totalPages: number;
};

export type ReturnSummaryStat = {
  count: number;
  totalRefund: number;
};

export type ReturnSummaryResponse = {
  pending: ReturnSummaryStat;
  approved: ReturnSummaryStat;
  rejected: ReturnSummaryStat;
  completed: ReturnSummaryStat;
  totalRefundAll: number;
  totalReturns: number;
  totalExchanges: number;
};
