import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  GoodsReceiptDetailItemResponse,
  GoodsReceiptDetailResponse,
  GoodsReceiptListItemResponse,
  GoodsReceiptListResponse,
  GoodsReceiptStatsQueryDto,
  GoodsReceiptStatsResponse,
  ListGoodsReceiptsQueryDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const LIST_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  purchaseOrder: {
    select: {
      orderNumber: true,
      totalAmount: true,
      status: true,
      supplier: { select: { name: true } },
    },
  },
  _count: { select: { items: true } },
} satisfies Prisma.GoodsReceiptSelect;

const DETAIL_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  purchaseOrder: {
    select: {
      orderNumber: true,
      orderDate: true,
      status: true,
      totalAmount: true,
      supplier: {
        select: { name: true, contact: true, address: true },
      },
    },
  },
  items: {
    select: {
      id: true,
      goodsReceiptId: true,
      productId: true,
      productName: true,
      quantityOrdered: true,
      quantityReceived: true,
      unitPrice: true,
      previousPurchasePrice: true,
      notes: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GoodsReceiptSelect;

type RawList = Prisma.GoodsReceiptGetPayload<{ select: typeof LIST_SELECT }>;
type RawDetail = Prisma.GoodsReceiptGetPayload<{
  select: typeof DETAIL_SELECT;
}>;

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListGoodsReceiptsQueryDto,
  ): Promise<GoodsReceiptListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { receivedAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.goodsReceipt.count({ where }),
    ]);

    return {
      receipts: rows.map(toListItemResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<GoodsReceiptDetailResponse> {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: DETAIL_SELECT,
    });
    if (!receipt) {
      throw new NotFoundException("Bukti penerimaan tidak ditemukan");
    }
    return toDetailResponse(receipt);
  }

  async findByPurchaseOrder(
    companyId: string,
    purchaseOrderId: string,
  ): Promise<GoodsReceiptDetailResponse[]> {
    const rows = await this.prisma.goodsReceipt.findMany({
      where: {
        purchaseOrderId,
        ...this.tenantWhere(companyId),
      },
      select: DETAIL_SELECT,
      orderBy: { receivedAt: "desc" },
    });
    return rows.map(toDetailResponse);
  }

  async stats(
    companyId: string,
    query: GoodsReceiptStatsQueryDto,
  ): Promise<GoodsReceiptStatsResponse> {
    const baseWhere: Prisma.GoodsReceiptWhereInput = this.tenantWhere(
      companyId,
    );
    if (query.branchId && query.branchId !== "ALL") {
      baseWhere.branchId = query.branchId;
    }

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, today, thisMonth] = await Promise.all([
      this.prisma.goodsReceipt.count({ where: baseWhere }),
      this.prisma.goodsReceipt.count({
        where: { ...baseWhere, receivedAt: { gte: startOfToday } },
      }),
      this.prisma.goodsReceipt.count({
        where: { ...baseWhere, receivedAt: { gte: startOfMonth } },
      }),
    ]);

    return { total, today, thisMonth };
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.goodsReceipt.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Bukti penerimaan tidak ditemukan");
    }
    await this.prisma.goodsReceipt.delete({ where: { id } });
    return { success: true };
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    if (ids.length === 0) {
      return { success: true, deleted: 0 };
    }
    const result = await this.prisma.goodsReceipt.deleteMany({
      where: {
        id: { in: ids },
        ...this.tenantWhere(companyId),
      },
    });
    return { success: true, deleted: result.count };
  }

  private buildListWhere(
    companyId: string,
    query: ListGoodsReceiptsQueryDto,
  ): Prisma.GoodsReceiptWhereInput {
    const where: Prisma.GoodsReceiptWhereInput = this.tenantWhere(companyId);

    if (query.branchId && query.branchId !== "ALL") {
      where.branchId = query.branchId;
    }
    if (query.purchaseOrderId) {
      where.purchaseOrderId = query.purchaseOrderId;
    }
    if (query.status) {
      where.purchaseOrder = {
        status: query.status as Prisma.EnumPurchaseOrderStatusFilter,
      };
    }
    if (query.supplierId) {
      where.purchaseOrder = {
        ...(where.purchaseOrder as Prisma.PurchaseOrderWhereInput | undefined),
        supplierId: query.supplierId,
      };
    }
    if (query.search) {
      where.OR = [
        { receiptNumber: { contains: query.search, mode: "insensitive" } },
        {
          purchaseOrder: {
            orderNumber: { contains: query.search, mode: "insensitive" },
          },
        },
        {
          purchaseOrder: {
            supplier: {
              name: { contains: query.search, mode: "insensitive" },
            },
          },
        },
        { receivedByName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.from || query.to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from) range.gte = parseDate(query.from, false);
      if (query.to) range.lte = parseDate(query.to, true);
      where.receivedAt = range;
    }

    return where;
  }

  private tenantWhere(companyId: string): Prisma.GoodsReceiptWhereInput {
    return {
      OR: [
        { companyId },
        { purchaseOrder: { companyId } },
        { purchaseOrder: { supplier: { companyId } } },
        { branch: { companyId } },
      ],
    };
  }
}

function parseDate(input: string, endOfDay: boolean): Date {
  // Accept either ISO datetime or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(input + (endOfDay ? "T23:59:59" : "T00:00:00"));
  }
  return new Date(input);
}

function toListItemResponse(row: RawList): GoodsReceiptListItemResponse {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrder: row.purchaseOrder
      ? {
          orderNumber: row.purchaseOrder.orderNumber,
          totalAmount: row.purchaseOrder.totalAmount,
          status: row.purchaseOrder.status,
          supplier: row.purchaseOrder.supplier
            ? { name: row.purchaseOrder.supplier.name }
            : null,
        }
      : null,
    branch: row.branch ? { name: row.branch.name } : null,
    receivedBy: row.receivedBy,
    receivedByName: row.receivedByName,
    notes: row.notes,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    itemsCount: row._count.items,
  };
}

function toDetailItemResponse(
  it: RawDetail["items"][number],
): GoodsReceiptDetailItemResponse {
  return {
    id: it.id,
    goodsReceiptId: it.goodsReceiptId,
    productId: it.productId,
    productName: it.productName,
    quantityOrdered: it.quantityOrdered,
    quantityReceived: it.quantityReceived,
    unitPrice: it.unitPrice ?? null,
    previousPurchasePrice: it.previousPurchasePrice ?? null,
    notes: it.notes,
  };
}

function toDetailResponse(row: RawDetail): GoodsReceiptDetailResponse {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrder: row.purchaseOrder
      ? {
          orderNumber: row.purchaseOrder.orderNumber,
          orderDate: row.purchaseOrder.orderDate.toISOString(),
          status: row.purchaseOrder.status,
          totalAmount: row.purchaseOrder.totalAmount,
          supplier: row.purchaseOrder.supplier
            ? {
                name: row.purchaseOrder.supplier.name,
                contact: row.purchaseOrder.supplier.contact,
                address: row.purchaseOrder.supplier.address,
              }
            : null,
        }
      : null,
    branch: row.branch ? { name: row.branch.name } : null,
    receivedBy: row.receivedBy,
    receivedByName: row.receivedByName,
    notes: row.notes,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    items: row.items.map(toDetailItemResponse),
  };
}
