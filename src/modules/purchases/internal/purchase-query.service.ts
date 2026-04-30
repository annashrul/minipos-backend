import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListPurchasesQueryDto,
  PurchaseListResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderStatusDto,
  PurchaseSummaryResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  toPurchaseDetailResponse,
  toPurchaseResponse,
} from "./purchases.mapper";
import {
  PO_DETAIL_SELECT,
  PO_SELECT,
  tenantWhere,
} from "./purchases.select";

@Injectable()
export class PurchaseQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        select: PO_SELECT,
        orderBy: { orderDate: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      purchases: rows.map(toPurchaseResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async summary(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseSummaryResponse> {
    const where = this.buildListWhere(companyId, query);

    const [agg, byStatus] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ["status"],
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalCount: agg._count._all,
      totalAmount: agg._sum.totalAmount ?? 0,
      byStatus: byStatus.map((row) => ({
        status: row.status as PurchaseOrderStatusDto,
        count: row._count._all,
        totalAmount: row._sum.totalAmount ?? 0,
      })),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: PO_DETAIL_SELECT,
    });
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    return toPurchaseDetailResponse(po);
  }

  private buildListWhere(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const { search, status, supplierId, branchId, from, to } = query;
    const where: Prisma.PurchaseOrderWhereInput = tenantWhere(companyId);
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    if (from || to) {
      where.orderDate = {};
      if (from) where.orderDate.gte = new Date(from);
      if (to) where.orderDate.lte = new Date(to);
    }
    return where;
  }
}
