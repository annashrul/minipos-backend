import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

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
  deviceId: true,
  customerPhone: true,
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
  // Sertakan PAID payments session ini supaya toOrderResponse bisa
  // compute paid-status per order (cross-ref ke rawPayload.coveredOrderIds).
  session: {
    select: {
      payments: {
        where: { status: "PAID" },
        select: { id: true, rawPayload: true },
      },
    },
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
export type RawSession = Prisma.TableSessionGetPayload<{
  select: typeof SESSION_SELECT;
}>;

@Injectable()
export class TableOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Table lookups ──

  async findTableByToken(qrToken: string) {
    return this.prisma.restaurantTable.findUnique({
      where: { qrToken },
      select: {
        id: true,
        number: true,
        name: true,
        section: true,
        status: true,
        branchId: true,
        branch: { select: { id: true, name: true, companyId: true } },
      },
    });
  }

  // ── Order lookups ──

  async findOrderForCompany(companyId: string, orderId: string) {
    return this.prisma.tableOrder.findFirst({
      where: { id: orderId, branch: { companyId } },
      select: {
        id: true,
        sessionId: true,
        tableId: true,
        branchId: true,
        status: true,
        total: true,
        customerNote: true,
        items: { select: { productName: true, qty: true, note: true } },
      },
    });
  }

  async findOrdersFull(
    where: Prisma.TableOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<RawOrder[]> {
    return this.prisma.tableOrder.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countOrders(where: Prisma.TableOrderWhereInput): Promise<number> {
    return this.prisma.tableOrder.count({ where });
  }

  async updateOrder(id: string, data: Prisma.TableOrderUpdateInput): Promise<RawOrder> {
    return this.prisma.tableOrder.update({
      where: { id },
      data,
      select: ORDER_SELECT,
    });
  }

  // ── Session lookups ──

  async findSessionForCompany(
    companyId: string,
    sessionId: string,
  ): Promise<RawSession | null> {
    return this.prisma.tableSession.findFirst({
      where: { id: sessionId, branch: { companyId } },
      select: SESSION_SELECT,
    });
  }

  async findSessionsFull(
    where: Prisma.TableSessionWhereInput,
    skip: number,
    take: number,
  ): Promise<RawSession[]> {
    return this.prisma.tableSession.findMany({
      where,
      select: SESSION_SELECT,
      orderBy: { openedAt: "desc" },
      skip,
      take,
    });
  }

  async countSessions(where: Prisma.TableSessionWhereInput): Promise<number> {
    return this.prisma.tableSession.count({ where });
  }

  async findActiveSession(tableId: string): Promise<RawSession | null> {
    return this.prisma.tableSession.findFirst({
      where: {
        tableId,
        status: { in: ["OPEN", "AWAITING_PAYMENT"] },
      },
      select: SESSION_SELECT,
      orderBy: { openedAt: "desc" },
    });
  }

  async findSessionForPayment(sessionId: string, tableId: string) {
    return this.prisma.tableSession.findFirst({
      where: { id: sessionId, tableId },
      select: {
        id: true,
        status: true,
        subtotal: true,
        branchId: true,
        tableId: true,
      },
    });
  }

  // ── Stale session cleanup lookup ──

  async findStaleSessions(
    companyId: string,
    cutoff: Date,
    branchId?: string | null,
  ) {
    return this.prisma.tableSession.findMany({
      where: {
        branch: { companyId },
        status: { in: ["OPEN", "AWAITING_PAYMENT"] },
        openedAt: { lt: cutoff },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        tableId: true,
        branchId: true,
        orders: {
          where: {
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
          select: { id: true },
        },
      },
    });
  }

  // ── Public catalog / products ──

  async findCatalogCategories(companyId: string) {
    return this.prisma.category.findMany({
      where: {
        companyId,
        products: {
          some: {
            isActive: true,
            itemType: { not: "INGREDIENT" },
          },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async findPublicProducts(
    where: Prisma.ProductWhereInput,
    limit: number,
    cursor?: string,
  ) {
    return this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        imageUrl: true,
        description: true,
        unit: true,
        // Stok base (non-recipe). Untuk recipe-based product, akan
        // di-override service dengan hasil computeRecipeStockByProduct.
        stock: true,
        _count: { select: { units: true, modifierGroups: true } },
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async findPublicProductDetail(companyId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        companyId,
        isActive: true,
        itemType: { not: "INGREDIENT" },
      },
      select: {
        id: true,
        name: true,
        code: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        imageUrl: true,
        description: true,
        unit: true,
        stock: true,
        units: {
          select: {
            id: true,
            name: true,
            conversionQty: true,
            sellingPrice: true,
            isDefault: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            modifierGroup: {
              include: {
                options: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
      },
    });
  }

  // ── Submit order: product resolution ──

  async findProductsForOrder(companyId: string, productIds: string[]) {
    return this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        companyId,
        isActive: true,
        itemType: { not: "INGREDIENT" },
      },
      select: {
        id: true,
        name: true,
        sellingPrice: true,
        unit: true,
        units: {
          select: {
            id: true,
            name: true,
            conversionQty: true,
            sellingPrice: true,
          },
        },
        modifierGroups: {
          include: {
            modifierGroup: {
              include: { options: true },
            },
          },
        },
      },
    });
  }

  // ── Payment helpers ──

  async createPayment(data: Prisma.TableSessionPaymentUncheckedCreateInput) {
    return this.prisma.tableSessionPayment.create({
      data,
      select: {
        id: true,
        sessionId: true,
        provider: true,
        channel: true,
        amount: true,
        status: true,
        externalId: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  async updateSessionStatus(sessionId: string, status: string) {
    return this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { status },
    });
  }

  // ── Invoice helpers ──

  async countTransactionsToday(branchId: string, startOfDay: Date): Promise<number> {
    return this.prisma.transaction.count({
      where: { branchId, createdAt: { gte: startOfDay } },
    });
  }

  async findLastInvoiceDisplayNumber(companyId: string, prefix: string) {
    return this.prisma.transaction.findFirst({
      where: {
        companyId,
        invoiceDisplayNumber: { startsWith: prefix },
      },
      orderBy: { invoiceDisplayNumber: "desc" },
      select: { invoiceDisplayNumber: true },
    });
  }

  // ── Transaction verification (linkTransactionAndClose) ──

  async findTransactionForCompany(companyId: string, transactionId: string) {
    return this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: { id: true },
    });
  }
}
