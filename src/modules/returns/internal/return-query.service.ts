import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListReturnsQueryDto,
  ReturnDetailResponse,
  ReturnListResponse,
  ReturnSummaryResponse,
  SearchExchangeProductsQueryDto,
  SearchExchangeProductsResponse,
  SearchReturnTransactionQueryDto,
  SearchReturnTransactionResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { toReturnDetailResponse, toReturnResponse } from "./returns.mapper";
import {
  RETURN_DETAIL_SELECT,
  RETURN_SELECT,
  tenantWhereClause,
} from "./returns.select";

@Injectable()
export class ReturnQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Promise<ReturnListResponse> {
    const where = this.buildListWhere(companyId, query);
    const orderBy = this.buildOrderBy(query);

    const [rows, total] = await Promise.all([
      this.prisma.returnExchange.findMany({
        where,
        select: RETURN_SELECT,
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.returnExchange.count({ where }),
    ]);

    return {
      returns: rows.map((r) => toReturnResponse(r, 0)),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async summary(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Promise<ReturnSummaryResponse> {
    const where = this.buildListWhere(companyId, {
      ...query,
      page: 1,
      perPage: 1,
    });

    const groups = await this.prisma.returnExchange.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { totalRefund: true },
    });

    const stats = {
      pending: { count: 0, totalRefund: 0 },
      approved: { count: 0, totalRefund: 0 },
      rejected: { count: 0, totalRefund: 0 },
      completed: { count: 0, totalRefund: 0 },
    };
    for (const g of groups) {
      const key = g.status.toLowerCase() as keyof typeof stats;
      if (stats[key]) {
        stats[key] = {
          count: g._count._all,
          totalRefund: g._sum.totalRefund ?? 0,
        };
      }
    }

    const [returnsCount, exchangesCount, totalAgg] = await Promise.all([
      this.prisma.returnExchange.count({ where: { ...where, type: "RETURN" } }),
      this.prisma.returnExchange.count({
        where: { ...where, type: "EXCHANGE" },
      }),
      this.prisma.returnExchange.aggregate({
        where,
        _sum: { totalRefund: true },
      }),
    ]);

    return {
      pending: stats.pending,
      approved: stats.approved,
      rejected: stats.rejected,
      completed: stats.completed,
      totalRefundAll: totalAgg._sum.totalRefund ?? 0,
      totalReturns: returnsCount,
      totalExchanges: exchangesCount,
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    const ret = await this.prisma.returnExchange.findFirst({
      where: { id, ...tenantWhereClause(companyId) },
      select: RETURN_DETAIL_SELECT,
    });
    if (!ret) throw new NotFoundException("Return not found");
    return toReturnDetailResponse(ret);
  }

  async searchTransactionForReturn(
    companyId: string,
    query: SearchReturnTransactionQueryDto,
  ): Promise<SearchReturnTransactionResponse> {
    const q = query.q.trim();
    if (!q) throw new BadRequestException("Query wajib diisi");

    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
      OR: [
        { invoiceNumber: { equals: q, mode: "insensitive" } },
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    };
    if (query.branchId) where.branchId = query.branchId;

    const transaction = await this.prisma.transaction.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        invoiceNumber: true,
        userId: true,
        user: { select: { id: true, name: true } },
        branchId: true,
        branch: { select: { id: true, name: true } },
        customerId: true,
        customer: { select: { id: true, name: true } },
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        grandTotal: true,
        paymentMethod: true,
        paymentAmount: true,
        changeAmount: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            productCode: true,
            quantity: true,
            unitName: true,
            unitPrice: true,
            discount: true,
            subtotal: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }
    if (transaction.status === "VOIDED") {
      throw new BadRequestException("Transaksi ini sudah di-void");
    }

    const priorReturned = await this.prisma.returnExchangeItem.groupBy({
      by: ["productId"],
      where: {
        returnExchange: {
          transactionId: transaction.id,
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
      },
      _sum: { quantity: true },
    });
    const returnedMap = new Map<string, number>(
      priorReturned.map((p) => [p.productId, p._sum.quantity ?? 0]),
    );

    return {
      id: transaction.id,
      invoiceNumber: transaction.invoiceNumber,
      userId: transaction.userId,
      user: transaction.user
        ? { id: transaction.user.id, name: transaction.user.name }
        : null,
      branchId: transaction.branchId,
      branch: transaction.branch
        ? { id: transaction.branch.id, name: transaction.branch.name }
        : null,
      customerId: transaction.customerId,
      customer: transaction.customer
        ? { id: transaction.customer.id, name: transaction.customer.name }
        : null,
      subtotal: transaction.subtotal,
      discountAmount: transaction.discountAmount,
      taxAmount: transaction.taxAmount,
      grandTotal: transaction.grandTotal,
      paymentMethod: transaction.paymentMethod,
      paymentAmount: transaction.paymentAmount,
      changeAmount: transaction.changeAmount,
      status: transaction.status,
      notes: transaction.notes,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
      itemCount: transaction.items.length,
      items: transaction.items.map((it) => {
        const returnedQty = returnedMap.get(it.productId) ?? 0;
        return {
          id: it.id,
          productId: it.productId,
          productName: it.productName,
          productCode: it.productCode,
          quantity: it.quantity,
          unitName: it.unitName,
          unitPrice: it.unitPrice,
          discount: it.discount,
          subtotal: it.subtotal,
          returnedQty,
          availableQty: Math.max(it.quantity - returnedQty, 0),
        };
      }),
    };
  }

  async searchProductsForExchange(
    companyId: string,
    query: SearchExchangeProductsQueryDto,
  ): Promise<SearchExchangeProductsResponse> {
    const q = query.q.trim();
    if (q.length < 2) return { products: [] };

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
      ],
    };

    const products = await this.prisma.product.findMany({
      where,
      take: 20,
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        imageUrl: true,
        unit: true,
      },
    });

    if (products.length === 0) return { products: [] };

    let branchStockMap: Map<string, number> | null = null;
    if (query.branchId) {
      const stocks = await this.prisma.branchStock.findMany({
        where: {
          branchId: query.branchId,
          productId: { in: products.map((p) => p.id) },
        },
        select: { productId: true, quantity: true },
      });
      branchStockMap = new Map(stocks.map((s) => [s.productId, s.quantity]));
    }

    return {
      products: products.map((p) => {
        const branchStock = branchStockMap?.get(p.id);
        const availableStock = branchStock ?? p.stock;
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          sellingPrice: p.sellingPrice,
          stock: p.stock,
          imageUrl: p.imageUrl,
          unit: p.unit,
          availableStock,
        };
      }),
    };
  }

  private buildListWhere(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Prisma.ReturnExchangeWhereInput {
    const { search, type, status, customerId, branchId, from, to } = query;
    const where: Prisma.ReturnExchangeWhereInput = tenantWhereClause(companyId);

    if (search) {
      where.OR = [
        { returnNumber: { contains: search, mode: "insensitive" } },
        {
          transaction: {
            invoiceNumber: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }
    if (type) where.type = type;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    return where;
  }

  private buildOrderBy(
    q: ListReturnsQueryDto,
  ): Prisma.ReturnExchangeOrderByWithRelationInput {
    const dir: "asc" | "desc" = q.sortDir ?? "asc";
    if (!q.sortBy) return { createdAt: "desc" };
    switch (q.sortBy) {
      case "returnNumber":
      case "totalRefund":
      case "createdAt":
        return {
          [q.sortBy]: dir,
        } as Prisma.ReturnExchangeOrderByWithRelationInput;
      default:
        return { createdAt: "desc" };
    }
  }
}
