import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateOrderQueueDto,
  CreateOrderQueueFromTransactionDto,
  ListOrderQueuesQueryDto,
  OrderQueueItemStatusDto,
  OrderQueueResponse,
  OrderQueueStatusDto,
} from "./dto/order-queues.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";

const QUEUE_SELECT = {
  id: true,
  queueNumber: true,
  transactionId: true,
  transaction: { select: { id: true, invoiceNumber: true, invoiceDisplayNumber: true } },
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  tableId: true,
  table: { select: { id: true, number: true, name: true } },
  status: true,
  priority: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  servedAt: true,
  items: {
    select: {
      id: true,
      productName: true,
      quantity: true,
      notes: true,
      status: true,
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OrderQueueSelect;

type RawQueue = Prisma.OrderQueueGetPayload<{ select: typeof QUEUE_SELECT }>;

import { RealtimeService, EVENTS } from "../realtime/realtime.service";

@Injectable()
export class OrderQueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListOrderQueuesQueryDto,
  ): Promise<PaginatedResponse<OrderQueueResponse>> {
    const { branchId, status, tableId, from, to, page, perPage } = query;

    const where: Prisma.OrderQueueWhereInput = {
      OR: [
        { branch: { companyId } },
        { branchId: null, transaction: { user: { companyId } } },
      ],
    };
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (tableId) where.tableId = tableId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.orderQueue.findMany({
        where,
        select: QUEUE_SELECT,
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.orderQueue.count({ where }),
    ]);

    return paginate(rows.map(toQueueResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<OrderQueueResponse> {
    const queue = await this.prisma.orderQueue.findFirst({
      where: this.tenantWhere(companyId, id),
      select: QUEUE_SELECT,
    });
    if (!queue) throw new NotFoundException("Order queue not found");
    return toQueueResponse(queue);
  }

  async create(
    companyId: string,
    dto: CreateOrderQueueDto,
  ): Promise<OrderQueueResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);
    if (dto.tableId) await this.assertTable(companyId, dto.tableId);
    if (dto.transactionId) {
      await this.assertTransaction(companyId, dto.transactionId);
    }

    const queueNumber = await this.nextQueueNumber(dto.branchId ?? null);

    const created = await this.prisma.orderQueue.create({
      data: {
        queueNumber,
        transactionId: dto.transactionId ?? null,
        branchId: dto.branchId ?? null,
        tableId: dto.tableId ?? null,
        status: "NEW",
        priority: dto.priority ?? 0,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            notes: i.notes ?? null,
            status: "PENDING",
          })),
        },
      },
      select: QUEUE_SELECT,
    });
    const resp = toQueueResponse(created);
    this.realtime.emit(
      EVENTS.ORDER_QUEUE_CREATED,
      { queueId: resp.id, queueNumber: resp.queueNumber },
      created.branchId ?? undefined,
    );
    return resp;
  }

  async createFromTransaction(
    companyId: string,
    dto: CreateOrderQueueFromTransactionDto,
  ): Promise<OrderQueueResponse> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: dto.transactionId, user: { companyId } },
      select: {
        id: true,
        branchId: true,
        tableId: true,
        items: { select: { productName: true, quantity: true } },
      },
    });
    if (!tx) throw new NotFoundException("Transaction not found");
    if (tx.items.length === 0) {
      throw new BadRequestException("Transaksi tidak memiliki item");
    }

    const queueNumber = await this.nextQueueNumber(tx.branchId);

    const created = await this.prisma.orderQueue.create({
      data: {
        queueNumber,
        transactionId: tx.id,
        branchId: tx.branchId,
        tableId: dto.tableId ?? tx.tableId,
        status: "NEW",
        priority: dto.priority ?? 0,
        notes: dto.notes ?? null,
        items: {
          create: tx.items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            status: "PENDING",
          })),
        },
      },
      select: QUEUE_SELECT,
    });
    const resp = toQueueResponse(created);
    this.realtime.emit(
      EVENTS.ORDER_QUEUE_CREATED,
      { queueId: resp.id, queueNumber: resp.queueNumber, fromTransaction: true },
      created.branchId ?? undefined,
    );
    return resp;
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: OrderQueueStatusDto,
  ): Promise<OrderQueueResponse> {
    const existing = await this.prisma.orderQueue.findFirst({
      where: this.tenantWhere(companyId, id),
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Order queue not found");

    const updated = await this.prisma.orderQueue.update({
      where: { id },
      data: {
        status,
        servedAt: status === "SERVED" ? new Date() : undefined,
      },
      select: QUEUE_SELECT,
    });
    const resp = toQueueResponse(updated);
    this.realtime.emit(
      status === "CANCELLED" ? EVENTS.ORDER_QUEUE_CANCELLED : EVENTS.ORDER_QUEUE_UPDATED,
      { queueId: resp.id, queueNumber: resp.queueNumber, status },
      updated.branchId ?? undefined,
    );

    // ── Cascade status ke TableOrder yang ter-link (kalau ada),
    // supaya tablet customer ikut refresh realtime.
    const tableOrderStatus = mapQueueStatusToTableOrder(status);
    if (tableOrderStatus) {
      const linkedOrders = await this.prisma.tableOrder.findMany({
        where: { orderQueueId: id },
        select: { id: true, sessionId: true, tableId: true, branchId: true },
      });
      if (linkedOrders.length > 0) {
        await this.prisma.tableOrder.updateMany({
          where: { orderQueueId: id },
          data: { status: tableOrderStatus },
        });
        for (const o of linkedOrders) {
          // Use specific event for READY (matches tablet listener) and STATUS for the rest.
          const event =
            tableOrderStatus === "READY"
              ? EVENTS.TABLE_ORDER_READY
              : EVENTS.TABLE_ORDER_STATUS;
          this.realtime.emit(
            event,
            {
              orderId: o.id,
              sessionId: o.sessionId,
              tableId: o.tableId,
              status: tableOrderStatus,
            },
            o.branchId,
          );
        }
      }
    }
    return resp;
  }

  async updateItemStatus(
    companyId: string,
    queueId: string,
    itemId: string,
    status: OrderQueueItemStatusDto,
  ): Promise<OrderQueueResponse> {
    const queue = await this.prisma.orderQueue.findFirst({
      where: this.tenantWhere(companyId, queueId),
      select: { id: true },
    });
    if (!queue) throw new NotFoundException("Order queue not found");

    const item = await this.prisma.orderQueueItem.findFirst({
      where: { id: itemId, orderQueueId: queueId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("Order queue item not found");

    await this.prisma.orderQueueItem.update({
      where: { id: itemId },
      data: { status },
    });

    return this.findById(companyId, queueId);
  }

  private tenantWhere(
    companyId: string,
    id: string,
  ): Prisma.OrderQueueWhereInput {
    return {
      id,
      OR: [
        { branch: { companyId } },
        { branchId: null, transaction: { user: { companyId } } },
      ],
    };
  }

  private async nextQueueNumber(branchId: string | null): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const last = await this.prisma.orderQueue.findFirst({
      where: { branchId, createdAt: { gte: startOfDay } },
      orderBy: { queueNumber: "desc" },
      select: { queueNumber: true },
    });
    return (last?.queueNumber ?? 0) + 1;
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async assertTable(companyId: string, tableId: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, branch: { companyId } },
      select: { id: true },
    });
    if (!table) throw new NotFoundException("Table not found");
  }

  private async assertTransaction(companyId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: { id: true },
    });
    if (!tx) throw new NotFoundException("Transaction not found");
  }
}

function toQueueResponse(q: RawQueue): OrderQueueResponse {
  return {
    id: q.id,
    queueNumber: q.queueNumber,
    transactionId: q.transactionId,
    transaction: q.transaction
      ? {
          id: q.transaction.id,
          invoiceNumber: q.transaction.invoiceNumber,
          invoiceDisplayNumber: q.transaction.invoiceDisplayNumber ?? null,
        }
      : null,
    branchId: q.branchId,
    branch: q.branch ? { id: q.branch.id, name: q.branch.name } : null,
    tableId: q.tableId,
    table: q.table
      ? { id: q.table.id, number: q.table.number, name: q.table.name }
      : null,
    status: q.status,
    priority: q.priority,
    notes: q.notes,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    servedAt: q.servedAt ? q.servedAt.toISOString() : null,
    items: q.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      quantity: i.quantity,
      notes: i.notes,
      status: i.status,
    })),
  };
}

/**
 * Map kitchen queue status → tablet-facing TableOrder status.
 * Only return a status when the change is meaningful for the customer.
 */
function mapQueueStatusToTableOrder(
  s: OrderQueueStatusDto,
): "SENT_TO_KITCHEN" | "READY" | "SERVED" | "CANCELLED" | null {
  switch (s) {
    case "PREPARING": return "SENT_TO_KITCHEN";
    case "READY":     return "READY";
    case "SERVED":    return "SERVED";
    case "CANCELLED": return "CANCELLED";
    case "NEW":
    default:          return null;
  }
}
