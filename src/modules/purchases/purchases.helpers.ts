import type {
  GoodsReceiptItemResponse,
  GoodsReceiptResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  PurchaseOrderStatusDto,
} from "./dto/purchases.dto";
import type { RawPO, RawPODetail, RawReceipt } from "./purchases.repository";

function toPOItemResponse(
  it: RawPO["items"][number],
): PurchaseOrderItemResponse {
  const variantLabel = it.variant
    ? it.variant.options.map((o) => o.option.name).join(" · ")
    : null;
  let currentMasterPrice: number | null = null;
  if (it.unitId) {
    currentMasterPrice = it.unit?.purchasePrice ?? null;
  } else if (it.variantId) {
    currentMasterPrice =
      it.variant?.purchasePriceOverride ?? it.product?.purchasePrice ?? null;
  } else {
    currentMasterPrice = it.product?.purchasePrice ?? null;
  }
  return {
    id: it.id,
    purchaseOrderId: it.purchaseOrderId,
    productId: it.productId,
    product: it.product
      ? { id: it.product.id, code: it.product.code, name: it.product.name }
      : null,
    unitId: it.unitId ?? null,
    unitName: it.unit?.name ?? null,
    variantId: it.variantId ?? null,
    variantLabel: variantLabel || null,
    quantity: it.quantity,
    receivedQty: it.receivedQty,
    unitPrice: it.unitPrice,
    subtotal: it.subtotal,
    currentMasterPrice,
    previousPurchasePrice:
      (it as unknown as { previousPurchasePrice?: number | null })
        .previousPurchasePrice ?? null,
  };
}

export function toPurchaseResponse(po: RawPO): PurchaseOrderResponse {
  return {
    id: po.id,
    orderNumber: po.orderNumber,
    purchaseTransactionNumber: po.purchaseTransactionNumber,
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
    unitPrice: it.unitPrice ?? null,
    previousPurchasePrice: it.previousPurchasePrice ?? null,
    notes: it.notes,
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
