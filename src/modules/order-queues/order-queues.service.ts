import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
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
import { OrderQueuesRepository, type RawQueue } from "./order-queues.repository";

import { RealtimeService, EVENTS } from "../realtime/realtime.service";

@Injectable()
export class OrderQueuesService {
  constructor(
    private readonly repo: OrderQueuesRepository,
    private readonly realtime: RealtimeService,
    private readonly assert: AssertService,
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
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toQueueResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<OrderQueueResponse> {
    const queue = await this.repo.findOne(this.tenantWhere(companyId, id));
    if (!queue) throw new NotFoundException("Order queue not found");
    return toQueueResponse(queue);
  }

  async create(
    companyId: string,
    dto: CreateOrderQueueDto,
  ): Promise<OrderQueueResponse> {
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);
    if (dto.tableId) await this.assertTable(companyId, dto.tableId);
    if (dto.transactionId) {
      await this.assertTransaction(companyId, dto.transactionId);
    }

    const queueNumber = await this.nextQueueNumber(dto.branchId ?? null);

    const created = await this.repo.create({
      queueNumber,
      transaction: dto.transactionId
        ? { connect: { id: dto.transactionId } }
        : undefined,
      branch: dto.branchId ? { connect: { id: dto.branchId } } : undefined,
      table: dto.tableId ? { connect: { id: dto.tableId } } : undefined,
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
    const tx = await this.repo.findTransactionForQueue(companyId, dto.transactionId);
    if (!tx) throw new NotFoundException("Transaction not found");
    if (tx.items.length === 0) {
      throw new BadRequestException("Transaksi tidak memiliki item");
    }

    const queueNumber = await this.nextQueueNumber(tx.branchId);

    const created = await this.repo.create({
      queueNumber,
      transaction: { connect: { id: tx.id } },
      branch: tx.branchId ? { connect: { id: tx.branchId } } : undefined,
      table: dto.tableId
        ? { connect: { id: dto.tableId } }
        : tx.tableId
          ? { connect: { id: tx.tableId } }
          : undefined,
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
    const existing = await this.repo.findOne(this.tenantWhere(companyId, id));
    if (!existing) throw new NotFoundException("Order queue not found");

    const updated = await this.repo.update(id, {
      status,
      servedAt: status === "SERVED" ? new Date() : undefined,
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
      const linkedOrders = await this.repo.findLinkedTableOrders(id);
      if (linkedOrders.length > 0) {
        await this.repo.updateLinkedTableOrders(id, tableOrderStatus);
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
    const queue = await this.repo.findOne(this.tenantWhere(companyId, queueId));
    if (!queue) throw new NotFoundException("Order queue not found");

    const item = await this.repo.findQueueItem(itemId, queueId);
    if (!item) throw new NotFoundException("Order queue item not found");

    await this.repo.updateQueueItem(itemId, { status });

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
    const last = await this.repo.findLastQueueNumber(branchId, startOfDay);
    return (last ?? 0) + 1;
  }

  private async assertTable(companyId: string, tableId: string) {
    const table = await this.repo.assertTable(companyId, tableId);
    if (!table) throw new NotFoundException("Table not found");
  }

  private async assertTransaction(companyId: string, transactionId: string) {
    const tx = await this.repo.assertTransaction(companyId, transactionId);
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
