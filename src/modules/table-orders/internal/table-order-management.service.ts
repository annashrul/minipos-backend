import {
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListTableOrdersQueryDto,
  TableOrderListResponse,
  TableOrderResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import {
  findOrderForCompany,
  nextQueueNumber,
} from "./table-orders.helpers";
import { toOrderResponse } from "./table-orders.mapper";
import { ORDER_SELECT } from "./table-orders.select";

@Injectable()
export class TableOrderManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listOrders(
    companyId: string,
    query: ListTableOrdersQueryDto,
  ): Promise<TableOrderListResponse> {
    const where: Prisma.TableOrderWhereInput = {
      branch: { companyId },
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.tableId) where.tableId = query.tableId;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    const [rows, total] = await Promise.all([
      this.prisma.tableOrder.findMany({
        where,
        select: ORDER_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.tableOrder.count({ where }),
    ]);
    return {
      orders: rows.map(toOrderResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async approve(
    companyId: string,
    userId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    const order = await findOrderForCompany(this.prisma, companyId, orderId);
    if (order.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Order tidak dalam status menunggu approval",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const queueNumber = await nextQueueNumber(tx, order.branchId);
      const queue = await tx.orderQueue.create({
        data: {
          queueNumber,
          branchId: order.branchId,
          tableId: order.tableId,
          status: "NEW",
          notes: order.customerNote ?? null,
          items: {
            create: order.items.map((i) => ({
              productName: i.productName,
              quantity: i.qty,
              notes: i.note ?? null,
              status: "PENDING",
            })),
          },
        },
        select: { id: true, queueNumber: true },
      });

      const u = await tx.tableOrder.update({
        where: { id: order.id },
        data: {
          status: "SENT_TO_KITCHEN",
          approvedBy: userId,
          approvedAt: new Date(),
          orderQueueId: queue.id,
        },
        select: ORDER_SELECT,
      });
      return { order: u, queue };
    });

    const resp = toOrderResponse(updated.order);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_APPROVED,
      {
        orderId: resp.id,
        sessionId: resp.sessionId,
        tableId: resp.tableId,
        queueId: updated.queue.id,
        queueNumber: updated.queue.queueNumber,
      },
      order.branchId,
    );
    this.realtime.emit(
      EVENTS.ORDER_QUEUE_CREATED,
      {
        queueId: updated.queue.id,
        queueNumber: updated.queue.queueNumber,
        fromTableOrder: true,
      },
      order.branchId,
    );
    return resp;
  }

  async reject(
    companyId: string,
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<TableOrderResponse> {
    const order = await findOrderForCompany(this.prisma, companyId, orderId);
    if (order.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Order tidak dalam status menunggu approval",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.tableOrder.update({
        where: { id: order.id },
        data: {
          status: "REJECTED",
          rejectReason: reason,
          approvedBy: userId,
          approvedAt: new Date(),
        },
        select: ORDER_SELECT,
      });
      await tx.tableSession.update({
        where: { id: order.sessionId },
        data: { subtotal: { decrement: order.total } },
      });
      return u;
    });

    const resp = toOrderResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_REJECTED,
      { orderId: resp.id, sessionId: resp.sessionId, tableId: resp.tableId, reason },
      order.branchId,
    );
    return resp;
  }

  async markOrderReady(
    companyId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    const order = await findOrderForCompany(this.prisma, companyId, orderId);
    const updated = await this.prisma.tableOrder.update({
      where: { id: order.id },
      data: { status: "READY" },
      select: ORDER_SELECT,
    });
    const resp = toOrderResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_READY,
      { orderId: resp.id, sessionId: resp.sessionId, tableId: resp.tableId },
      order.branchId,
    );
    return resp;
  }
}
