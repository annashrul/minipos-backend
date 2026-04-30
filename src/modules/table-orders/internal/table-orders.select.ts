import { Prisma } from "@prisma/client";

export const ORDER_SELECT = {
  id: true,
  sessionId: true,
  tableId: true,
  branchId: true,
  status: true,
  total: true,
  customerNote: true,
  rejectReason: true,
  approvedBy: true,
  approvedAt: true,
  orderQueueId: true,
  createdAt: true,
  updatedAt: true,
  table: { select: { id: true, number: true, name: true } },
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      qty: true,
      unitPrice: true,
      subtotal: true,
      note: true,
      product: { select: { code: true } },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.TableOrderSelect;

export const SESSION_SELECT = {
  id: true,
  tableId: true,
  branchId: true,
  status: true,
  customerName: true,
  customerPhone: true,
  subtotal: true,
  paidAmount: true,
  transactionId: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  table: { select: { id: true, number: true, name: true } },
  orders: { select: ORDER_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.TableSessionSelect;

export type RawOrder = Prisma.TableOrderGetPayload<{ select: typeof ORDER_SELECT }>;
export type RawSession = Prisma.TableSessionGetPayload<{ select: typeof SESSION_SELECT }>;
