import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  TableOrderResponse,
  TableSessionResponse,
} from "./dto/table-orders.dto";
import type { RawOrder, RawSession, TableOrdersRepository } from "./table-orders.repository";
import type { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, type RealtimeService } from "@/modules/realtime/realtime.service";

// ──────────────────────────────────────────────────────────────
// Shared constants
// ──────────────────────────────────────────────────────────────
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const STALE_SESSION_MS = readPositiveInt(
  "TABLE_ORDER_AUTO_CANCEL_MS",
  5 * 60 * 60_000,
);

// ──────────────────────────────────────────────────────────────
// findTableByToken — shared lookup
// ──────────────────────────────────────────────────────────────
export async function findTableByToken(
  repo: TableOrdersRepository,
  qrToken: string,
) {
  const table = await repo.findTableByToken(qrToken);
  if (!table || !table.branchId) {
    throw new NotFoundException("Token meja tidak valid");
  }
  return table;
}

// ──────────────────────────────────────────────────────────────
// cleanupStaleSessions — shared stale-session cleanup
// ──────────────────────────────────────────────────────────────
export async function cleanupStaleSessions(
  repo: TableOrdersRepository,
  prisma: PrismaService,
  realtime: RealtimeService,
  companyId: string,
  branchId?: string | null,
): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS);
  const stale = await repo.findStaleSessions(companyId, cutoff, branchId);
  if (stale.length === 0) return;

  const sessionIds = stale.map((s) => s.id);
  const tableIds = [...new Set(stale.map((s) => s.tableId))];
  const branchIds = [...new Set(stale.map((s) => s.branchId))];
  const orderIds = stale.flatMap((s) => s.orders.map((o) => o.id));

  await prisma.$transaction(async (tx) => {
    await tx.tableOrder.updateMany({
      where: {
        sessionId: { in: sessionIds },
        status: {
          in: [
            "PENDING_APPROVAL",
            "APPROVED",
            "SENT_TO_KITCHEN",
            "READY",
            "SERVED",
          ],
        },
      },
      data: {
        status: "CANCELLED",
        rejectReason: "Auto-cancel: pesanan tidak diproses lebih dari 5 jam.",
      },
    });
    await tx.tableSessionPayment.updateMany({
      where: { sessionId: { in: sessionIds }, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    await tx.tableSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await tx.restaurantTable.updateMany({
      where: {
        id: { in: tableIds },
        tableSessions: {
          none: { status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
        },
      },
      data: { status: "AVAILABLE" },
    });
  });

  for (const bid of branchIds) {
    realtime.emit(
      EVENTS.TABLE_ORDER_STATUS,
      {
        reason: "auto_cancel_stale",
        sessionIds,
        orderIds,
        expiredAfterMs: STALE_SESSION_MS,
      },
      bid,
    );
    realtime.emit(
      EVENTS.TABLE_SESSION_CLOSED,
      {
        reason: "auto_cancel_stale",
        sessionIds,
        tableIds,
        expiredAfterMs: STALE_SESSION_MS,
      },
      bid,
    );
  }
}

// ──────────────────────────────────────────────────────────────
// Response mappers
// ──────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────
// Invoice / queue helpers
// ──────────────────────────────────────────────────────────────
export async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const last = await tx.orderQueue.findFirst({
    where: { branchId, createdAt: { gte: startOfDay } },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });
  return (last?.queueNumber ?? 0) + 1;
}

export async function nextInvoiceNumber(
  repo: TableOrdersRepository,
  branchId: string,
): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const count = await repo.countTransactionsToday(branchId, startOfDay);
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${ymd}-${seq}`;
}

/**
 * Generate display invoice number "INV-DDMMYYYY-NNNNN" sequential per
 * (companyId, date). Mirror logika di TransactionsService.generateDisplayInvoiceNumber.
 */
export async function nextInvoiceDisplayNumber(
  repo: TableOrdersRepository,
  companyId: string,
): Promise<string> {
  const date = new Date();
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const prefix = `INV-${dd}${mm}${yyyy}-`;

  const last = await repo.findLastInvoiceDisplayNumber(companyId, prefix);

  let nextSeq = 1;
  if (last?.invoiceDisplayNumber) {
    const tail = last.invoiceDisplayNumber.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
  }
  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}
