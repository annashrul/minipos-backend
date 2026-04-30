import type {
  GoodsReceiptItemResponse,
  GoodsReceiptResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  PurchaseOrderStatusDto,
} from "@/contracts";
import type { RawPO, RawPODetail, RawReceipt } from "./purchases.select";

export function toPOItemResponse(
  it: RawPO["items"][number],
): PurchaseOrderItemResponse {
  return {
    id: it.id,
    purchaseOrderId: it.purchaseOrderId,
    productId: it.productId,
    product: it.product
      ? { id: it.product.id, code: it.product.code, name: it.product.name }
      : null,
    quantity: it.quantity,
    receivedQty: it.receivedQty,
    unitPrice: it.unitPrice,
    subtotal: it.subtotal,
  };
}

export function toPurchaseResponse(po: RawPO): PurchaseOrderResponse {
  return {
    id: po.id,
    orderNumber: po.orderNumber,
    supplierId: po.supplierId,
    supplier: po.supplier
      ? { id: po.supplier.id, name: po.supplier.name }
      : null,
    branchId: po.branchId,
    branch: po.branch ? { id: po.branch.id, name: po.branch.name } : null,
    status: po.status as PurchaseOrderStatusDto,
    totalAmount: po.totalAmount,
    receivedAmount: po.receivedAmount,
    paidAmount: po.paidAmount,
    notes: po.notes,
    orderDate: po.orderDate.toISOString(),
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    receivedDate: po.receivedDate ? po.receivedDate.toISOString() : null,
    createdBy: po.createdBy,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    items: po.items.map(toPOItemResponse),
    receiptCount: po._count.goodsReceipts,
  };
}

export function toPurchaseDetailResponse(
  po: RawPODetail,
): PurchaseOrderDetailResponse {
  return {
    ...toPurchaseResponse(po),
    receipts: po.goodsReceipts.map(toReceiptResponse),
  };
}

function toReceiptItemResponse(
  it: RawReceipt["items"][number],
): GoodsReceiptItemResponse {
  return {
    id: it.id,
    goodsReceiptId: it.goodsReceiptId,
    productId: it.productId,
    productName: it.productName,
    quantityOrdered: it.quantityOrdered,
    quantityReceived: it.quantityReceived,
    notes: it.notes,
  };
}

export function toReceiptResponse(r: RawReceipt): GoodsReceiptResponse {
  return {
    id: r.id,
    receiptNumber: r.receiptNumber,
    purchaseOrderId: r.purchaseOrderId,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    receivedBy: r.receivedBy,
    receivedByName: r.receivedByName,
    notes: r.notes,
    receivedAt: r.receivedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    items: r.items.map(toReceiptItemResponse),
  };
}
