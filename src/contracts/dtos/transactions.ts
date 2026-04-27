import { z } from "zod";

export const TransactionStatusSchema = z.enum([
  "COMPLETED",
  "PENDING",
  "HELD",
  "VOIDED",
  "REFUNDED",
]);
export type TransactionStatusDto = z.infer<typeof TransactionStatusSchema>;

export const PaymentMethodSchema = z.enum([
  "CASH",
  "TRANSFER",
  "QRIS",
  "EWALLET",
  "DEBIT",
  "CREDIT_CARD",
  "TERMIN",
]);
export type PaymentMethodDto = z.infer<typeof PaymentMethodSchema>;

export const ListTransactionsQuerySchema = z.object({
  search: z.string().optional(),
  status: TransactionStatusSchema.optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  branchId: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum([
      "invoiceNumber",
      "createdAt",
      "user",
      "grandTotal",
      "paymentMethod",
      "status",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListTransactionsQueryDto = z.infer<typeof ListTransactionsQuerySchema>;

export type TransactionItemResponse = {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
  unitName: string;
  unitPrice: number;
  discount: number;
  subtotal: number;
};

export type TransactionResponse = {
  id: string;
  invoiceNumber: string;
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
  voidReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type TransactionDetailResponse = TransactionResponse & {
  items: TransactionItemResponse[];
};

export type TransactionListResponse = {
  transactions: TransactionResponse[];
  total: number;
  totalPages: number;
};

export const CheckoutBundleComponentSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  productCode: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative().optional().default(0),
});
export type CheckoutBundleComponentDto = z.infer<
  typeof CheckoutBundleComponentSchema
>;

export const CheckoutItemModifierSchema = z.object({
  groupId: z.string().min(1).optional(),
  groupName: z.string().optional(),
  optionId: z.string().min(1).optional(),
  optionName: z.string().optional(),
  priceAdjustment: z.number().optional().default(0),
});
export type CheckoutItemModifierDto = z.infer<
  typeof CheckoutItemModifierSchema
>;

export const CheckoutItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  productCode: z.string().min(1),
  quantity: z.number().int().min(1),
  unitName: z.string().optional().default("PCS"),
  conversionQty: z.number().int().min(1).optional().default(1),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional().default(0),
  subtotal: z.number().nonnegative(),
  bundleId: z.string().optional(),
  bundleItems: z.array(CheckoutBundleComponentSchema).optional(),
  modifiers: z.array(CheckoutItemModifierSchema).optional(),
  notes: z.string().optional(),
});
export type CheckoutItemDto = z.infer<typeof CheckoutItemSchema>;

export const CheckoutPaymentSchema = z.object({
  method: PaymentMethodSchema,
  amount: z.number().nonnegative(),
  reference: z.string().nullable().optional(),
});
export type CheckoutPaymentDto = z.infer<typeof CheckoutPaymentSchema>;

export const TerminConfigSchema = z.object({
  downPayment: z.number().nonnegative().optional().default(0),
  installmentCount: z.number().int().min(1),
  interval: z.enum(["WEEKLY", "MONTHLY"]),
});
export type TerminConfigDto = z.infer<typeof TerminConfigSchema>;

export const CheckoutSchema = z
  .object({
    items: z.array(CheckoutItemSchema).min(1),
    subtotal: z.number().nonnegative(),
    discountAmount: z.number().nonnegative().optional().default(0),
    taxAmount: z.number().nonnegative().optional().default(0),
    grandTotal: z.number().nonnegative(),
    paymentMethod: PaymentMethodSchema,
    paymentAmount: z.number().nonnegative(),
    changeAmount: z.number().nonnegative().optional().default(0),
    payments: z.array(CheckoutPaymentSchema).optional(),
    customerId: z.string().nullable().optional(),
    branchId: z.string().nullable().optional(),
    promoApplied: z.string().nullable().optional(),
    promoIds: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
    terminConfig: TerminConfigSchema.nullable().optional(),
    redeemPoints: z.number().int().min(0).optional(),
  })
  .refine(
    (v) => {
      const hasTermin =
        v.paymentMethod === "TERMIN" ||
        v.payments?.some((p) => p.method === "TERMIN");
      return !hasTermin || !!v.customerId;
    },
    {
      message: "Pembayaran TERMIN memerlukan customerId",
      path: ["customerId"],
    },
  )
  .refine(
    (v) =>
      v.items.every(
        (i) =>
          !i.productId.startsWith("bundle:") ||
          (i.bundleItems != null && i.bundleItems.length > 0),
      ),
    {
      message: "Item bundle harus menyertakan bundleItems components",
      path: ["items"],
    },
  );
export type CheckoutDto = z.infer<typeof CheckoutSchema>;

export type CheckoutResponse = {
  id: string;
  invoiceNumber: string;
  pointsEarned: number;
  pointsRedeemed: number;
};

export const VoidTransactionSchema = z.object({
  reason: z.string().min(1, "Reason wajib diisi"),
});
export type VoidTransactionDto = z.infer<typeof VoidTransactionSchema>;

export const RefundTransactionSchema = z.object({
  reason: z.string().min(1, "Reason wajib diisi"),
});
export type RefundTransactionDto = z.infer<typeof RefundTransactionSchema>;

export type VoidTransactionResponse = {
  id: string;
  invoiceNumber: string;
  status: "VOIDED";
  branchId: string | null;
};

export type RefundTransactionResponse = {
  id: string;
  invoiceNumber: string;
  status: "REFUNDED";
  branchId: string | null;
};

export const TransactionStatsQuerySchema = z.object({
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type TransactionStatsQueryDto = z.infer<
  typeof TransactionStatsQuerySchema
>;

export type TransactionStatsResponse = {
  totalSales: number;
  transactionCount: number;
  avgTransaction: number;
  totalRefund: number;
  totalVoid: number;
};
