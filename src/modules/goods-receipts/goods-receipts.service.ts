import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  GoodsReceiptDetailItemResponse,
  GoodsReceiptDetailResponse,
  GoodsReceiptListItemResponse,
  GoodsReceiptStatsQueryDto,
  GoodsReceiptStatsResponse,
  ListGoodsReceiptsQueryDto,
} from "./dto/goods-receipts.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { tenantWhere } from "@/common/utils/tenant";
import {
  GoodsReceiptsRepository,
  type RawGoodsReceiptDetail,
  type RawGoodsReceiptList,
} from "./goods-receipts.repository";

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly repo: GoodsReceiptsRepository) {}

  async list(
    companyId: string,
    query: ListGoodsReceiptsQueryDto,
  ): Promise<PaginatedResponse<GoodsReceiptListItemResponse>> {
    const where = this.buildListWhere(companyId, query);
    const { page, perPage } = query;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toListItemResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<GoodsReceiptDetailResponse> {
    const receipt = await this.repo.findOne({
      id,
      ...tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch"),
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
    const rows = await this.repo.findManyDetail({
      purchaseOrderId,
      ...tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch"),
    });
    return rows.map(toDetailResponse);
  }

  async stats(
    companyId: string,
    query: GoodsReceiptStatsQueryDto,
  ): Promise<GoodsReceiptStatsResponse> {
    const baseWhere: Prisma.GoodsReceiptWhereInput = tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch");
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
      this.repo.count(baseWhere),
      this.repo.count({ ...baseWhere, receivedAt: { gte: startOfToday } }),
      this.repo.count({ ...baseWhere, receivedAt: { gte: startOfMonth } }),
    ]);

    return { total, today, thisMonth };
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById({
      id,
      ...tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch"),
    });
    if (!existing) {
      throw new NotFoundException("Bukti penerimaan tidak ditemukan");
    }
    await this.repo.delete(id);
    return { success: true };
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    if (ids.length === 0) {
      return { success: true, deleted: 0 };
    }
    const deleted = await this.repo.deleteMany({
      id: { in: ids },
      ...tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch"),
    });
    return { success: true, deleted };
  }

  private buildListWhere(
    companyId: string,
    query: ListGoodsReceiptsQueryDto,
  ): Prisma.GoodsReceiptWhereInput {
    const where: Prisma.GoodsReceiptWhereInput = tenantWhere(companyId, "direct", "purchaseOrder", "purchaseOrder.supplier", "branch");

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

}

function parseDate(input: string, endOfDay: boolean): Date {
  // Accept either ISO datetime or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(input + (endOfDay ? "T23:59:59" : "T00:00:00"));
  }
  return new Date(input);
}

function toListItemResponse(row: RawGoodsReceiptList): GoodsReceiptListItemResponse {
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
  it: RawGoodsReceiptDetail["items"][number],
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

function toDetailResponse(row: RawGoodsReceiptDetail): GoodsReceiptDetailResponse {
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
