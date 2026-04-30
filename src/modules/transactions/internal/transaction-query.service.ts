import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListTransactionsQueryDto,
  TransactionDetailResponse,
  TransactionListResponse,
  TransactionStatsQueryDto,
  TransactionStatsResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  toTransactionDetailResponse,
  toTransactionResponse,
} from "./transactions.mapper";
import { TX_DETAIL_SELECT, TX_SELECT } from "./transactions.select";

@Injectable()
export class TransactionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponse> {
    const where = this.buildListWhere(companyId, query);
    const orderBy = this.buildOrderBy(query);

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        select: TX_SELECT,
        orderBy,
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions: rows.map(toTransactionResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<TransactionDetailResponse> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: TX_DETAIL_SELECT,
    });
    if (!tx) throw new NotFoundException("Transaction not found");
    return toTransactionDetailResponse(tx);
  }

  async stats(
    companyId: string,
    query: TransactionStatsQueryDto,
  ): Promise<TransactionStatsResponse> {
    const baseWhere = this.buildStatsWhere(companyId, query);

    const [completedAgg, refundedAgg, voidedAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, status: "COMPLETED" },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, status: "REFUNDED" },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, status: "VOIDED" },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
    ]);

    const totalSales = completedAgg._sum.grandTotal ?? 0;
    const transactionCount = completedAgg._count._all;
    return {
      totalSales,
      transactionCount,
      avgTransaction: transactionCount > 0 ? totalSales / transactionCount : 0,
      totalRefund: refundedAgg._count._all,
      totalVoid: voidedAgg._count._all,
    };
  }

  private buildListWhere(
    companyId: string,
    q: ListTransactionsQueryDto,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { user: { companyId } };
    if (q.search) {
      where.invoiceNumber = { contains: q.search, mode: "insensitive" };
    }
    if (q.status) where.status = q.status;
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod;
    if (q.branchId) where.branchId = q.branchId;
    if (q.userId) where.userId = q.userId;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    return where;
  }

  private buildOrderBy(
    q: ListTransactionsQueryDto,
  ): Prisma.TransactionOrderByWithRelationInput {
    const dir: "asc" | "desc" = q.sortDir ?? "desc";
    if (!q.sortBy) return { createdAt: "desc" };
    switch (q.sortBy) {
      case "user":
        return { user: { name: dir } };
      case "invoiceNumber":
      case "createdAt":
      case "grandTotal":
      case "paymentMethod":
      case "status":
        return {
          [q.sortBy]: dir,
        } as Prisma.TransactionOrderByWithRelationInput;
      default:
        return { createdAt: "desc" };
    }
  }

  private buildStatsWhere(
    companyId: string,
    q: TransactionStatsQueryDto,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { user: { companyId } };
    if (q.branchId) where.branchId = q.branchId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    return where;
  }
}
