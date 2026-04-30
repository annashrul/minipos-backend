import type {
  TableOrderResponse,
  TableSessionResponse,
} from "@/contracts";
import type { RawOrder, RawSession } from "./table-orders.select";

export function toOrderResponse(o: RawOrder): TableOrderResponse {
  return {
    id: o.id,
    sessionId: o.sessionId,
    tableId: o.tableId,
    branchId: o.branchId,
    status: o.status,
    total: o.total,
    customerNote: o.customerNote,
    rejectReason: o.rejectReason,
    approvedBy: o.approvedBy,
    approvedAt: o.approvedAt ? o.approvedAt.toISOString() : null,
    orderQueueId: o.orderQueueId,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    table: o.table
      ? { id: o.table.id, number: o.table.number, name: o.table.name }
      : null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.product?.code ?? "",
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
      note: i.note,
    })),
  };
}

export function toSessionResponse(s: RawSession): TableSessionResponse {
  return {
    id: s.id,
    tableId: s.tableId,
    branchId: s.branchId,
    status: s.status,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    subtotal: s.subtotal,
    paidAmount: s.paidAmount,
    transactionId: s.transactionId,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    table: s.table
      ? { id: s.table.id, number: s.table.number, name: s.table.name }
      : null,
    orders: s.orders.map(toOrderResponse),
  };
}
