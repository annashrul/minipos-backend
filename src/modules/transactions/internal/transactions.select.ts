import { Prisma } from "@prisma/client";

export const TX_SELECT = {
  id: true,
  invoiceNumber: true,
  userId: true,
  user: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  customerId: true,
  customer: { select: { id: true, name: true } },
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  grandTotal: true,
  paymentMethod: true,
  paymentAmount: true,
  changeAmount: true,
  status: true,
  voidReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.TransactionSelect;

export const TX_DETAIL_SELECT = {
  ...TX_SELECT,
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      productCode: true,
      quantity: true,
      unitName: true,
      unitPrice: true,
      discount: true,
      subtotal: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransactionSelect;

export type RawTx = Prisma.TransactionGetPayload<{ select: typeof TX_SELECT }>;
export type RawTxDetail = Prisma.TransactionGetPayload<{
  select: typeof TX_DETAIL_SELECT;
}>;
