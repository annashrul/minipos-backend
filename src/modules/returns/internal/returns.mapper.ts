import type {
  ReturnDetailResponse,
  ReturnItemResponse,
  ReturnResponse,
} from "@/contracts";
import type { RawReturn, RawReturnDetail, RawReturnItem } from "./returns.select";

export function toReturnResponse(
  r: RawReturn,
  totalExchange: number,
): ReturnResponse {
  return {
    id: r.id,
    returnNumber: r.returnNumber,
    transactionId: r.transactionId,
    transactionInvoice: r.transaction.invoiceNumber,
    customerId: r.customerId,
    customer: r.customer ? { id: r.customer.id, name: r.customer.name } : null,
    type: r.type,
    status: r.status,
    reason: r.reason,
    notes: r.notes,
    totalRefund: r.totalRefund,
    totalExchange,
    refundMethod: r.refundMethod,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    processedBy: r.processedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type ItemWithMeta = ReturnItemResponse & {
  _exchangeMeta: { unitPrice: number | null; subtotal: number | null };
};

function toReturnItemResponse(i: RawReturnItem): ItemWithMeta {
  const exchangeUnitPrice =
    i.exchangeProduct && i.exchangeQuantity && i.exchangeQuantity > 0
      ? i.exchangeProduct.sellingPrice
      : null;
  const exchangeSubtotal =
    exchangeUnitPrice !== null && i.exchangeQuantity
      ? exchangeUnitPrice * i.exchangeQuantity
      : null;

  return {
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    product: i.product
      ? { id: i.product.id, code: i.product.code, name: i.product.name }
      : null,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.subtotal,
    reason: i.reason,
    exchangeProductId: i.exchangeProductId,
    exchangeProduct: i.exchangeProduct
      ? {
          id: i.exchangeProduct.id,
          code: i.exchangeProduct.code,
          name: i.exchangeProduct.name,
        }
      : null,
    exchangeQuantity: i.exchangeQuantity,
    exchangeUnitPrice,
    exchangeSubtotal,
    restocked: i.restocked,
    _exchangeMeta: {
      unitPrice: exchangeUnitPrice,
      subtotal: exchangeSubtotal,
    },
  };
}

export function toReturnDetailResponse(
  r: RawReturnDetail,
): ReturnDetailResponse {
  const items = r.items.map(toReturnItemResponse);
  const totalExchange = items.reduce(
    (s, i) => s + (i._exchangeMeta.subtotal ?? 0),
    0,
  );
  const cleanedItems: ReturnItemResponse[] = items.map(
    ({ _exchangeMeta: _meta, ...rest }) => rest,
  );
  return {
    ...toReturnResponse(r, totalExchange),
    items: cleanedItems,
  };
}
