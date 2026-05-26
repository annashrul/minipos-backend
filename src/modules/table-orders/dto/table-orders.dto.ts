import { z } from "zod";

// ──────────────────────────────────────────────────────────────
// Status enums
// ──────────────────────────────────────────────────────────────
export const TableSessionStatusSchema = z.enum([
  "OPEN",
  "AWAITING_PAYMENT",
  "CLOSED",
]);
export type TableSessionStatusDto = z.infer<typeof TableSessionStatusSchema>;

export const TableOrderStatusSchema = z.enum([
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT_TO_KITCHEN",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export type TableOrderStatusDto = z.infer<typeof TableOrderStatusSchema>;

export const TablePaymentProviderSchema = z.enum([
  "QRIS",
  "MIDTRANS",
  "XENDIT",
  "MANUAL",
]);
export type TablePaymentProviderDto = z.infer<typeof TablePaymentProviderSchema>;

export const TablePaymentStatusSchema = z.enum([
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
]);
export type TablePaymentStatusDto = z.infer<typeof TablePaymentStatusSchema>;

// ──────────────────────────────────────────────────────────────
// Public (tablet) — by qrToken
// ──────────────────────────────────────────────────────────────
export const PublicTableInfoResponse = z.object({
  table: z.object({
    id: z.string(),
    number: z.number(),
    name: z.string().nullable(),
    section: z.string().nullable(),
  }),
  branch: z.object({
    id: z.string(),
    name: z.string(),
  }),
  companyId: z.string(),
});
export type PublicTableInfoResponseDto = z.infer<typeof PublicTableInfoResponse>;

export const SubmitTableOrderModifierSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});
export type SubmitTableOrderModifierDto = z.infer<typeof SubmitTableOrderModifierSchema>;

export const SubmitTableOrderItemSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().min(1),
  unitId: z.string().nullable().optional(), // ProductUnit.id; null/omit = base unit
  modifiers: z.array(SubmitTableOrderModifierSchema).optional(),
  note: z.string().nullable().optional(),
});
export type SubmitTableOrderItemDto = z.infer<typeof SubmitTableOrderItemSchema>;

export const SubmitTableOrderSchema = z.object({
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  customerNote: z.string().nullable().optional(),
  items: z.array(SubmitTableOrderItemSchema).min(1),
});
export type SubmitTableOrderDto = z.infer<typeof SubmitTableOrderSchema>;

// ──────────────────────────────────────────────────────────────
// Kasir (authenticated) — list / approve / reject / close
// ──────────────────────────────────────────────────────────────
export const ListTableOrdersQuerySchema = z.object({
  branchId: z.string().optional(),
  tableId: z.string().optional(),
  sessionId: z.string().optional(),
  status: TableOrderStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTableOrdersQueryDto = z.infer<typeof ListTableOrdersQuerySchema>;

export const ListTableSessionsQuerySchema = z.object({
  branchId: z.string().optional(),
  tableId: z.string().optional(),
  status: TableSessionStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTableSessionsQueryDto = z.infer<typeof ListTableSessionsQuerySchema>;

export const RejectTableOrderSchema = z.object({
  reason: z.string().min(1),
});
export type RejectTableOrderDto = z.infer<typeof RejectTableOrderSchema>;

// Cashier finalises payment for a session by creating a POS transaction
export const PayCashierSchema = z.object({
  paymentMethod: z.enum([
    "CASH",
    "DEBIT_CARD",
    "CREDIT_CARD",
    "EWALLET",
    "QRIS",
    "TRANSFER",
    "OTHER",
  ]),
  paymentAmount: z.number().min(0),
  notes: z.string().nullable().optional(),
});
export type PayCashierDto = z.infer<typeof PayCashierSchema>;

// Tablet-initiated online payment
export const StartOnlinePaymentSchema = z.object({
  provider: TablePaymentProviderSchema,
  channel: z.string().nullable().optional(),
});
export type StartOnlinePaymentDto = z.infer<typeof StartOnlinePaymentSchema>;

// ──────────────────────────────────────────────────────────────
// Response shapes
// ──────────────────────────────────────────────────────────────
export type TableOrderItemResponse = {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  note: string | null;
};

export type TableOrderResponse = {
  id: string;
  sessionId: string;
  tableId: string;
  branchId: string;
  status: string;
  total: number;
  customerNote: string | null;
  rejectReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  orderQueueId: string | null;
  createdAt: string;
  updatedAt: string;
  items: TableOrderItemResponse[];
  table?: { id: string; number: number; name: string | null } | null;
};

export type TableSessionResponse = {
  id: string;
  tableId: string;
  branchId: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: number;
  paidAmount: number;
  transactionId: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  table?: { id: string; number: number; name: string | null } | null;
  orders?: TableOrderResponse[];
};

export type TableOrderListResponse = {
  orders: TableOrderResponse[];
  total: number;
  totalPages: number;
};

export type TableSessionListResponse = {
  sessions: TableSessionResponse[];
  total: number;
  totalPages: number;
};

export type TablePaymentResponse = {
  id: string;
  sessionId: string;
  provider: string;
  channel: string | null;
  amount: number;
  status: string;
  externalId: string | null;
  paidAt: string | null;
  createdAt: string;
};

// Catalog snippet exposed to tablet (so customer can build cart)
export type PublicProductResponse = {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  categoryName: string;
  sellingPrice: number;
  imageUrl: string | null;
  description: string | null;
  unit: string;
  hasUnits?: boolean;
  hasModifiers?: boolean;
};

export type PublicProductUnitResponse = {
  id: string;
  name: string;
  conversionQty: number;
  sellingPrice: number;
  isDefault: boolean;
};

export type PublicModifierOptionResponse = {
  id: string;
  name: string;
  priceAdjustment: number;
};

export type PublicModifierGroupResponse = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: PublicModifierOptionResponse[];
};

export type PublicProductDetailResponse = PublicProductResponse & {
  units: PublicProductUnitResponse[];
  modifierGroups: PublicModifierGroupResponse[];
};

export type PublicCatalogResponse = {
  categories: { id: string; name: string }[];
  products: PublicProductResponse[];
};

export const PublicProductsQuerySchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type PublicProductsQueryDto = z.infer<typeof PublicProductsQuerySchema>;

export type PublicProductsPageResponse = {
  products: PublicProductResponse[];
  nextCursor: string | null;
};
