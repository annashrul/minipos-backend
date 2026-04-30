import { Prisma } from "@prisma/client";
import type { PurchaseOrderStatusDto } from "@/contracts";

export const PO_ITEM_SELECT = {
  id: true,
  purchaseOrderId: true,
  productId: true,
  product: { select: { id: true, code: true, name: true } },
  quantity: true,
  receivedQty: true,
  unitPrice: true,
  subtotal: true,
} satisfies Prisma.PurchaseOrderItemSelect;

export const PO_SELECT = {
  id: true,
  orderNumber: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, companyId: true } },
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  totalAmount: true,
  receivedAmount: true,
  paidAmount: true,
  notes: true,
  orderDate: true,
  expectedDate: true,
  receivedDate: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  items: { select: PO_ITEM_SELECT, orderBy: { createdAt: "asc" } },
  _count: { select: { goodsReceipts: true } },
} satisfies Prisma.PurchaseOrderSelect;

export const RECEIPT_ITEM_SELECT = {
  id: true,
  goodsReceiptId: true,
  productId: true,
  productName: true,
  quantityOrdered: true,
  quantityReceived: true,
  notes: true,
} satisfies Prisma.GoodsReceiptItemSelect;

export const RECEIPT_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  items: { select: RECEIPT_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.GoodsReceiptSelect;

export const PO_DETAIL_SELECT = {
  ...PO_SELECT,
  goodsReceipts: { select: RECEIPT_SELECT, orderBy: { receivedAt: "desc" } },
} satisfies Prisma.PurchaseOrderSelect;

export type RawPO = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_SELECT }>;
export type RawPODetail = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_DETAIL_SELECT;
}>;
export type RawReceipt = Prisma.GoodsReceiptGetPayload<{
  select: typeof RECEIPT_SELECT;
}>;

export const ALLOWED_TRANSITIONS: Record<
  PurchaseOrderStatusDto,
  PurchaseOrderStatusDto[]
> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function tenantWhere(
  companyId: string,
): Prisma.PurchaseOrderWhereInput {
  return {
    OR: [
      { companyId },
      { supplier: { companyId } },
      { branch: { companyId } },
    ],
  };
}
