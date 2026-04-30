import type {
  TransactionDetailResponse,
  TransactionResponse,
} from "@/contracts";
import type { RawTx, RawTxDetail } from "./transactions.select";

export function toTransactionResponse(t: RawTx): TransactionResponse {
  return {
    id: t.id,
    invoiceNumber: t.invoiceNumber,
    userId: t.userId,
    user: t.user ? { id: t.user.id, name: t.user.name } : null,
    branchId: t.branchId,
    branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
    customerId: t.customerId,
    customer: t.customer ? { id: t.customer.id, name: t.customer.name } : null,
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxAmount: t.taxAmount,
    grandTotal: t.grandTotal,
    paymentMethod: t.paymentMethod,
    paymentAmount: t.paymentAmount,
    changeAmount: t.changeAmount,
    status: t.status,
    voidReason: t.voidReason,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    itemCount: t._count.items,
  };
}

export function toTransactionDetailResponse(
  t: RawTxDetail,
): TransactionDetailResponse {
  return {
    ...toTransactionResponse(t),
    items: t.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: i.unitPrice,
      discount: i.discount,
      subtotal: i.subtotal,
    })),
  };
}
