import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const QUEUE_SELECT = {
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

export type RawQueue = Prisma.OrderQueueGetPayload<{ select: typeof QUEUE_SELECT }>;

@Injectable()
export class OrderQueuesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.OrderQueueWhereInput,
    skip: number,
    take: number,
  ): Promise<RawQueue[]> {
    return this.prisma.orderQueue.findMany({
      where,
      select: QUEUE_SELECT,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      skip,
      take,
    });
  }

  async count(where: Prisma.OrderQueueWhereInput): Promise<number> {
    return this.prisma.orderQueue.count({ where });
  }

  async findOne(where: Prisma.OrderQueueWhereInput): Promise<RawQueue | null> {
    return this.prisma.orderQueue.findFirst({
      where,
      select: QUEUE_SELECT,
    });
  }

  async create(data: Prisma.OrderQueueCreateInput): Promise<RawQueue> {
    return this.prisma.orderQueue.create({
      data,
      select: QUEUE_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.OrderQueueUpdateInput,
  ): Promise<RawQueue> {
    return this.prisma.orderQueue.update({
      where: { id },
      data,
      select: QUEUE_SELECT,
    });
  }

  async findLastQueueNumber(
    branchId: string | null,
    startOfDay: Date,
  ): Promise<number | null> {
    const last = await this.prisma.orderQueue.findFirst({
      where: { branchId, createdAt: { gte: startOfDay } },
      orderBy: { queueNumber: "desc" },
      select: { queueNumber: true },
    });
    return last?.queueNumber ?? null;
  }

  async findTransactionForQueue(companyId: string, transactionId: string) {
    return this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: {
        id: true,
        branchId: true,
        tableId: true,
        items: { select: { productName: true, quantity: true } },
      },
    });
  }

  async findQueueItem(itemId: string, orderQueueId: string) {
    return this.prisma.orderQueueItem.findFirst({
      where: { id: itemId, orderQueueId },
      select: { id: true },
    });
  }

  async updateQueueItem(itemId: string, data: Prisma.OrderQueueItemUpdateInput) {
    return this.prisma.orderQueueItem.update({
      where: { id: itemId },
      data,
    });
  }

  async findLinkedTableOrders(orderQueueId: string) {
    return this.prisma.tableOrder.findMany({
      where: { orderQueueId },
      select: { id: true, sessionId: true, tableId: true, branchId: true },
    });
  }

  async updateLinkedTableOrders(orderQueueId: string, status: string) {
    return this.prisma.tableOrder.updateMany({
      where: { orderQueueId },
      data: { status },
    });
  }

  async assertTable(companyId: string, tableId: string) {
    return this.prisma.restaurantTable.findFirst({
      where: { id: tableId, branch: { companyId } },
      select: { id: true },
    });
  }

  async assertTransaction(companyId: string, transactionId: string) {
    return this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: { id: true },
    });
  }
}
