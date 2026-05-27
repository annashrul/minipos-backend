import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { tenantWhere } from "@/common/utils/tenant";
import type {
  CreateReturnDto,
  ListReturnsQueryDto,
  RejectReturnDto,
  ReturnDetailResponse,
  ReturnItemResponse,
  ReturnResponse,
  ReturnSummaryResponse,
  SearchExchangeProductsQueryDto,
  SearchExchangeProductsResponse,
  SearchReturnTransactionQueryDto,
  SearchReturnTransactionResponse,
} from "./dto/returns.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ReturnsRepository,
  RETURN_DETAIL_SELECT,
  type RawReturn,
  type RawReturnDetail,
  type RawReturnItem,
} from "./returns.repository";
import { ReturnApprovalService } from "./return-approval.service";
import { toReturnResponse, toReturnDetailResponse } from "./returns.helpers";
export { toReturnResponse, toReturnItemResponse, toReturnDetailResponse } from "./returns.helpers";

type _ExchangeMeta = {
  unitPrice: number | null;
  subtotal: number | null;
};

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReturnsRepository,
    private readonly assert: AssertService,
    private readonly approval: ReturnApprovalService,
  ) {}

  async list(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Promise<PaginatedResponse<ReturnResponse>> {
    const where = this.buildListWhere(companyId, query);
    const { page, perPage } = query;

    const dir: "asc" | "desc" = query.sortDir ?? "asc";
    let orderBy: Prisma.ReturnExchangeOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (query.sortBy) {
      switch (query.sortBy) {
        case "returnNumber":
        case "totalRefund":
        case "createdAt":
          orderBy = {
            [query.sortBy]: dir,
          } as Prisma.ReturnExchangeOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map((r) => toReturnResponse(r, 0)), total, page, perPage);
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

    const groups = await this.repo.groupByStatus(where);

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
      this.repo.countByType(where, "RETURN"),
      this.repo.countByType(where, "EXCHANGE"),
      this.repo.aggregateTotalRefund(where),
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
    const ret = await this.repo.findOneDetail({
      id,
      ...tenantWhere(companyId, "transaction.user"),
    });
    if (!ret) throw new NotFoundException("Retur tidak ditemukan");
    return toReturnDetailResponse(ret);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateReturnDto,
  ): Promise<ReturnDetailResponse> {
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    const transaction = await this.repo.findTransactionForCreate(
      dto.transactionId,
      companyId,
    );
    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }

    // Aggregate purchased quantities per product in this transaction
    const purchasedMap = new Map<
      string,
      { quantity: number; unitPrice: number; productName: string }
    >();
    for (const it of transaction.items) {
      const existing = purchasedMap.get(it.productId);
      if (existing) {
        existing.quantity += it.quantity;
      } else {
        purchasedMap.set(it.productId, {
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          productName: it.productName,
        });
      }
    }

    // Sum previously returned quantities per product (any non-rejected return)
    const priorReturned = await this.repo.groupPriorReturned(dto.transactionId);
    const priorMap = new Map<string, number>(
      priorReturned.map((p) => [p.productId, p._sum.quantity ?? 0]),
    );

    // Validate items
    const aggregatedRequest = new Map<string, number>();
    for (const item of dto.items) {
      aggregatedRequest.set(
        item.productId,
        (aggregatedRequest.get(item.productId) ?? 0) + item.quantity,
      );
    }
    for (const [productId, qty] of aggregatedRequest) {
      const purchased = purchasedMap.get(productId);
      if (!purchased) {
        throw new BadRequestException(
          `Produk ${productId} tidak ditemukan pada transaksi`,
        );
      }
      const priorQty = priorMap.get(productId) ?? 0;
      const remaining = purchased.quantity - priorQty;
      if (qty > remaining) {
        throw new BadRequestException(
          `Jumlah retur produk ${purchased.productName} melebihi sisa yang dapat diretur (sisa: ${remaining})`,
        );
      }
    }

    // Validate exchange products belong to same company (if any)
    const exchangeProductIds = Array.from(
      new Set(
        dto.items
          .map((i) => i.exchangeProductId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (exchangeProductIds.length > 0) {
      const found = await this.repo.findExchangeProducts(
        exchangeProductIds,
        companyId,
      );
      if (found.length !== exchangeProductIds.length) {
        throw new BadRequestException(
          "Salah satu produk pengganti tidak ditemukan",
        );
      }
    }

    // Compute totals
    const returnedSum = dto.items.reduce((s, i) => s + i.subtotal, 0);
    const exchangeSum = dto.items.reduce((s, i) => {
      if (!i.exchangeProductId) return s;
      const sub =
        i.exchangeSubtotal ??
        (i.exchangeQuantity && i.exchangeUnitPrice
          ? i.exchangeQuantity * i.exchangeUnitPrice
          : 0);
      return s + sub;
    }, 0);

    let totalRefund = 0;
    if (dto.type === "RETURN") {
      totalRefund = returnedSum;
    } else {
      totalRefund = Math.max(returnedSum - exchangeSum, 0);
    }

    const branchId = dto.branchId ?? transaction.branchId ?? null;
    const customerId = transaction.customerId ?? null;

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const returnNumber = generateReturnNumber();
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const ret = await tx.returnExchange.create({
            data: {
              returnNumber,
              transactionId: dto.transactionId,
              customerId,
              type: dto.type,
              status: "PENDING",
              reason: dto.reason,
              notes: dto.notes ?? null,
              totalRefund,
              refundMethod: dto.refundMethod ?? null,
              branchId,
              processedBy: userId,
              items: {
                create: dto.items.map((item) => ({
                  productId: item.productId,
                  productName:
                    purchasedMap.get(item.productId)?.productName ?? "",
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  subtotal: item.subtotal,
                  exchangeProductId: item.exchangeProductId ?? null,
                  exchangeQuantity: item.exchangeQuantity ?? null,
                })),
              },
            },
            select: { id: true },
          });

          return tx.returnExchange.findUniqueOrThrow({
            where: { id: ret.id },
            select: RETURN_DETAIL_SELECT,
          });
        });
        return toReturnDetailResponse(created);
      } catch (err) {
        if (isReturnNumberConflict(err) && attempt < 2) {
          lastError = err;
          continue;
        }
        if (isReturnNumberConflict(err)) {
          throw new ConflictException("Nomor retur bentrok, coba lagi");
        }
        throw err;
      }
    }
    if (lastError) {
      throw new ConflictException("Nomor retur bentrok, coba lagi");
    }
    throw new ConflictException("Gagal membuat retur");
  }

  async approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    return this.approval.approve(companyId, userId, id);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    dto: RejectReturnDto,
  ): Promise<ReturnDetailResponse> {
    return this.approval.reject(companyId, userId, id, dto);
  }

  async complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    return this.approval.complete(companyId, userId, id);
  }

  async searchTransactionForReturn(
    companyId: string,
    query: SearchReturnTransactionQueryDto,
  ): Promise<SearchReturnTransactionResponse> {
    const q = query.q.trim();
    if (!q) throw new BadRequestException("Query wajib diisi");

    // Find transaction by exact invoice match first; fallback to partial
    // search across invoice + customer name.
    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
      OR: [
        { invoiceNumber: { equals: q, mode: "insensitive" } },
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { invoiceDisplayNumber: { equals: q, mode: "insensitive" } },
        { invoiceDisplayNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
      ],
    };
    if (query.branchId) where.branchId = query.branchId;

    const transaction = await this.repo.findTransaction(where);

    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }
    if (transaction.status === "VOIDED") {
      throw new BadRequestException("Transaksi ini sudah di-void");
    }

    // Compute previously-returned qty per product (PENDING/APPROVED/COMPLETED).
    const priorReturned = await this.repo.groupPriorReturned(transaction.id);
    const returnedMap = new Map<string, number>(
      priorReturned.map((p) => [p.productId, p._sum.quantity ?? 0]),
    );

    return {
      id: transaction.id,
      invoiceNumber: transaction.invoiceNumber,
      invoiceDisplayNumber: transaction.invoiceDisplayNumber ?? null,
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

    const products = await this.repo.searchProducts(where, 20);

    if (products.length === 0) return { products: [] };

    // If branchId provided, lookup branch-scoped stock.
    let branchStockMap: Map<string, number> | null = null;
    if (query.branchId) {
      const stocks = await this.repo.findBranchStocks(
        query.branchId,
        products.map((p) => p.id),
      );
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

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findForDelete({
      id,
      ...tenantWhere(companyId, "transaction.user"),
    });
    if (!existing) throw new NotFoundException("Retur tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya retur dengan status PENDING yang dapat dihapus",
      );
    }
    await this.prisma.$transaction([
      this.prisma.returnExchangeItem.deleteMany({
        where: { returnExchangeId: id },
      }),
      this.prisma.returnExchange.delete({ where: { id } }),
    ]);
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Prisma.ReturnExchangeWhereInput {
    const { search, type, status, customerId, branchId, from, to } = query;
    const where: Prisma.ReturnExchangeWhereInput =
      tenantWhere(companyId, "transaction.user");

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
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function generateReturnNumber(): string {
  const now = new Date();
  const datePart = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate(),
  )}`;
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `RET-${datePart}-${hex}`;
}

function isReturnNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("returnNumber")) return true;
    if (typeof target === "string" && target.includes("returnNumber")) {
      return true;
    }
  }
  return false;
}

