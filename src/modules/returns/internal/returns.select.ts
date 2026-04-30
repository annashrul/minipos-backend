import { Prisma } from "@prisma/client";

export const RETURN_SELECT = {
  id: true,
  returnNumber: true,
  transactionId: true,
  transaction: { select: { id: true, invoiceNumber: true } },
  customerId: true,
  customer: { select: { id: true, name: true } },
  type: true,
  status: true,
  reason: true,
  notes: true,
  totalRefund: true,
  refundMethod: true,
  approvedBy: true,
  approvedAt: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  processedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReturnExchangeSelect;

export const RETURN_ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  product: { select: { id: true, code: true, name: true } },
  quantity: true,
  unitPrice: true,
  subtotal: true,
  reason: true,
  exchangeProductId: true,
  exchangeProduct: {
    select: { id: true, code: true, name: true, sellingPrice: true },
  },
  exchangeQuantity: true,
  restocked: true,
} satisfies Prisma.ReturnExchangeItemSelect;

export const RETURN_DETAIL_SELECT = {
  ...RETURN_SELECT,
  items: {
    select: RETURN_ITEM_SELECT,
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.ReturnExchangeSelect;

export type RawReturn = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_SELECT;
}>;
export type RawReturnDetail = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_DETAIL_SELECT;
}>;
export type RawReturnItem = Prisma.ReturnExchangeItemGetPayload<{
  select: typeof RETURN_ITEM_SELECT;
}>;

export function tenantWhereClause(
  companyId: string,
): Prisma.ReturnExchangeWhereInput {
  return { transaction: { user: { companyId } } };
}
