import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
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
import { PrismaService } from "../prisma/prisma.service";

const RETURN_SELECT = {
  id: true,
  returnNumber: true,
  transactionId: true,
  transaction: { select: { id: true, invoiceNumber: true, invoiceDisplayNumber: true } },
  customerId: true,
  customer: { select: { id: true, name: true } },
  type: true,
  status: true,
  reason: true,
  notes: true,
  totalRefund: true,
  refundMethod: true,
  approvedBy: true,
  approvedAt: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  processedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReturnExchangeSelect;

const RETURN_ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  product: { select: { id: true, code: true, name: true } },
  quantity: true,
  unitPrice: true,
  subtotal: true,
  reason: true,
  exchangeProductId: true,
  exchangeProduct: {
    select: { id: true, code: true, name: true, sellingPrice: true },
  },
  exchangeQuantity: true,
  restocked: true,
} satisfies Prisma.ReturnExchangeItemSelect;

const RETURN_DETAIL_SELECT = {
  ...RETURN_SELECT,
  items: {
    select: RETURN_ITEM_SELECT,
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.ReturnExchangeSelect;

type RawReturn = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_SELECT;
}>;
type RawReturnDetail = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_DETAIL_SELECT;
}>;
type RawReturnItem = Prisma.ReturnExchangeItemGetPayload<{
  select: typeof RETURN_ITEM_SELECT;
}>;

type ExchangeMeta = {
  unitPrice: number | null;
  subtotal: number | null;
};

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assert: AssertService,
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
      this.prisma.returnExchange.findMany({
        where,
        select: RETURN_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.returnExchange.count({ where }),
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
      where: { id, ...this.tenantWhereClause(companyId) },
      select: RETURN_DETAIL_SELECT,
    });
    if (!ret) throw new NotFoundException("Return not found");
    return toReturnDetailResponse(ret);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateReturnDto,
  ): Promise<ReturnDetailResponse> {
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: dto.transactionId,
        user: { companyId },
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            productName: true,
          },
        },
      },
    });
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
    const priorReturned = await this.prisma.returnExchangeItem.groupBy({
      by: ["productId"],
      where: {
        returnExchange: {
          transactionId: dto.transactionId,
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
      },
      _sum: { quantity: true },
    });
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
      const found = await this.prisma.product.findMany({
        where: { id: { in: exchangeProductIds }, companyId },
        select: { id: true, sellingPrice: true, name: true },
      });
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
    // Approve = sekaligus complete: restock produk yg di-retur, decrement
    // produk pengganti (kalau EXCHANGE), terbitkan store credit (kalau ada).
    // Frontend hanya expose 1 tombol "Setujui", jadi tanpa langkah ini stok
    // tidak pernah balik ke gudang.
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...this.tenantWhereClause(companyId) },
      select: {
        id: true,
        status: true,
        type: true,
        returnNumber: true,
        totalRefund: true,
        refundMethod: true,
        customerId: true,
        branchId: true,
        transactionId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            exchangeProductId: true,
            exchangeQuantity: true,
            restocked: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya retur dengan status PENDING yang dapat disetujui",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const branchId = existing.branchId ?? null;

      for (const item of existing.items) {
        if (!item.restocked) {
          await this.adjustStock(tx, {
            productId: item.productId,
            branchId,
            delta: item.quantity, // restock kembali ke gudang
            reference: existing.returnNumber,
            note: `Retur ${existing.returnNumber}`,
            type: "IN",
            createdBy: userId,
            companyId,
            refId: existing.id,
          });
        }

        if (
          existing.type === "EXCHANGE" &&
          item.exchangeProductId &&
          item.exchangeQuantity &&
          item.exchangeQuantity > 0
        ) {
          await this.adjustStock(tx, {
            productId: item.exchangeProductId,
            branchId,
            delta: -item.exchangeQuantity,
            reference: existing.returnNumber,
            note: `Tukar produk ${existing.returnNumber}`,
            type: "OUT",
            createdBy: userId,
            companyId,
            refId: existing.id,
          });
        }

        await tx.returnExchangeItem.update({
          where: { id: item.id },
          data: { restocked: true },
        });
      }

      const completed = await tx.returnExchange.update({
        where: { id },
        data: {
          status: "COMPLETED",
          approvedBy: userId,
          approvedAt: new Date(),
        },
        select: RETURN_DETAIL_SELECT,
      });

      // Sinkron status transaksi sumber: kalau setelah retur ini total qty
      // yg di-return (lintas semua retur COMPLETED) sudah menutupi seluruh
      // qty yg dibeli per produk → transaksi pindah ke REFUNDED. Partial
      // return tetap dibiarkan COMPLETED — modul retur jadi single source
      // of truth nominal yg dikembalikan.
      const txStatus = await tx.transaction.findUnique({
        where: { id: existing.transactionId },
        select: { status: true },
      });
      if (txStatus && txStatus.status !== "REFUNDED") {
        const [{ fully_returned }] = await tx.$queryRaw<
          [{ fully_returned: boolean }]
        >`
          SELECT NOT EXISTS (
            SELECT 1
            FROM transaction_items ti
            LEFT JOIN (
              SELECT rei."productId",
                     COALESCE(SUM(rei.quantity), 0) AS returned_qty
              FROM return_exchange_items rei
              JOIN return_exchanges re ON re.id = rei."returnExchangeId"
              WHERE re."transactionId" = ${existing.transactionId}
                AND re.status = 'COMPLETED'
              GROUP BY rei."productId"
            ) ret ON ret."productId" = ti."productId"
            WHERE ti."transactionId" = ${existing.transactionId}
            GROUP BY ti."productId"
            HAVING SUM(ti.quantity) > COALESCE(MAX(ret.returned_qty), 0)
          ) AS fully_returned
        `;
        if (fully_returned) {
          await tx.transaction.update({
            where: { id: existing.transactionId },
            data: { status: "REFUNDED" },
          });
        }
      }

      return completed;
    });

    return toReturnDetailResponse(updated);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    dto: RejectReturnDto,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...this.tenantWhereClause(companyId) },
      select: { id: true, status: true, notes: true },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status === "COMPLETED" || existing.status === "REJECTED") {
      throw new BadRequestException(
        "Retur dengan status ini tidak dapat ditolak",
      );
    }

    const reason = dto.reason?.trim();
    const newNotes = reason
      ? existing.notes
        ? `${existing.notes}\n[REJECTED] ${reason}`
        : `[REJECTED] ${reason}`
      : existing.notes;

    const updated = await this.prisma.returnExchange.update({
      where: { id },
      data: {
        status: "REJECTED",
        notes: newNotes,
        approvedBy: userId,
        approvedAt: new Date(),
      },
      select: RETURN_DETAIL_SELECT,
    });
    return toReturnDetailResponse(updated);
  }

  async complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...this.tenantWhereClause(companyId) },
      select: {
        id: true,
        status: true,
        type: true,
        returnNumber: true,
        totalRefund: true,
        refundMethod: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            exchangeProductId: true,
            exchangeQuantity: true,
            restocked: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status !== "APPROVED") {
      throw new BadRequestException(
        "Retur harus dalam status APPROVED untuk diselesaikan",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const branchId = existing.branchId ?? null;

      // Restore stock for returned items, decrement for exchange items
      for (const item of existing.items) {
        if (!item.restocked) {
          await this.adjustStock(tx, {
            productId: item.productId,
            branchId,
            delta: item.quantity, // positive = increment (return restock)
            reference: existing.returnNumber,
            note: `Retur ${existing.returnNumber}`,
            type: "IN",
            createdBy: userId,
            companyId,
            refId: existing.id,
          });
        }

        if (
          existing.type === "EXCHANGE" &&
          item.exchangeProductId &&
          item.exchangeQuantity &&
          item.exchangeQuantity > 0
        ) {
          await this.adjustStock(tx, {
            productId: item.exchangeProductId,
            branchId,
            delta: -item.exchangeQuantity,
            reference: existing.returnNumber,
            note: `Tukar produk ${existing.returnNumber}`,
            type: "OUT",
            createdBy: userId,
            companyId,
            refId: existing.id,
          });
        }

        await tx.returnExchangeItem.update({
          where: { id: item.id },
          data: { restocked: true },
        });
      }

      await tx.returnExchange.update({
        where: { id },
        data: { status: "COMPLETED" },
      });

      return tx.returnExchange.findUniqueOrThrow({
        where: { id },
        select: RETURN_DETAIL_SELECT,
      });
    });

    return toReturnDetailResponse(updated);
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

    const transaction = await this.prisma.transaction.findFirst({
      where,
      orderBy: [
        // Exact invoice match wins via createdAt desc tiebreak.
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDisplayNumber: true,
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

    // Compute previously-returned qty per product (PENDING/APPROVED/COMPLETED).
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

    // If branchId provided, lookup branch-scoped stock.
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

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...this.tenantWhereClause(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Return not found");
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
      this.tenantWhereClause(companyId);

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

  private tenantWhereClause(
    companyId: string,
  ): Prisma.ReturnExchangeWhereInput {
    return {
      transaction: {
        user: { companyId },
      },
    };
  }

  private async adjustStock(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      branchId: string | null;
      delta: number;
      reference: string;
      note: string;
      type: "IN" | "OUT";
      createdBy: string;
      // Optional explicit context utk ledger refType/refId (return record).
      companyId?: string | null;
      refId?: string | null;
    },
  ) {
    const absQty = Math.abs(params.delta);
    if (absQty === 0) return;

    let balanceAfter: number | null = null;
    if (params.branchId) {
      const upserted = await tx.branchStock.upsert({
        where: {
          branchId_productId: {
            branchId: params.branchId,
            productId: params.productId,
          },
        },
        create: {
          branchId: params.branchId,
          productId: params.productId,
          quantity: Math.max(params.delta, 0),
        },
        update: {
          quantity:
            params.delta >= 0
              ? { increment: absQty }
              : { decrement: absQty },
        },
        select: { quantity: true },
      });
      balanceAfter = upserted.quantity;
    } else {
      const updatedP = await tx.product.update({
        where: { id: params.productId },
        data: {
          stock:
            params.delta >= 0
              ? { increment: absQty }
              : { decrement: absQty },
        },
        select: { stock: true },
      });
      balanceAfter = updatedP.stock;
    }

    const granularType = params.type === "IN" ? "RETURN_IN" : "RETURN_OUT";

    await tx.stockMovement.create({
      data: {
        productId: params.productId,
        branchId: params.branchId,
        ...(params.companyId ? { companyId: params.companyId } : {}),
        type: granularType,
        quantity: absQty,
        direction: params.type,
        balanceAfter,
        refType: "return_exchange",
        ...(params.refId ? { refId: params.refId } : {}),
        refNumber: params.reference,
        note: params.note,
        reference: params.reference,
        createdBy: params.createdBy,
      },
    });
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

function toReturnResponse(
  r: RawReturn,
  totalExchange: number,
): ReturnResponse {
  return {
    id: r.id,
    returnNumber: r.returnNumber,
    transactionId: r.transactionId,
    transactionInvoice:
      r.transaction.invoiceDisplayNumber ?? r.transaction.invoiceNumber,
    customerId: r.customerId,
    customer: r.customer ? { id: r.customer.id, name: r.customer.name } : null,
    type: r.type,
    status: r.status,
    reason: r.reason,
    notes: r.notes,
    totalRefund: r.totalRefund,
    totalExchange,
    refundMethod: r.refundMethod,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    processedBy: r.processedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toReturnItemResponse(
  i: RawReturnItem,
): ReturnItemResponse & { _exchangeMeta: ExchangeMeta } {
  const exchangeUnitPrice =
    i.exchangeProduct && i.exchangeQuantity && i.exchangeQuantity > 0
      ? i.exchangeProduct.sellingPrice
      : null;
  const exchangeSubtotal =
    exchangeUnitPrice !== null && i.exchangeQuantity
      ? exchangeUnitPrice * i.exchangeQuantity
      : null;

  return {
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    product: i.product
      ? { id: i.product.id, code: i.product.code, name: i.product.name }
      : null,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    subtotal: i.subtotal,
    reason: i.reason,
    exchangeProductId: i.exchangeProductId,
    exchangeProduct: i.exchangeProduct
      ? {
          id: i.exchangeProduct.id,
          code: i.exchangeProduct.code,
          name: i.exchangeProduct.name,
        }
      : null,
    exchangeQuantity: i.exchangeQuantity,
    exchangeUnitPrice,
    exchangeSubtotal,
    restocked: i.restocked,
    _exchangeMeta: {
      unitPrice: exchangeUnitPrice,
      subtotal: exchangeSubtotal,
    },
  };
}

function toReturnDetailResponse(
  r: RawReturnDetail,
): ReturnDetailResponse {
  const items = r.items.map(toReturnItemResponse);
  const totalExchange = items.reduce(
    (s, i) => s + (i._exchangeMeta.subtotal ?? 0),
    0,
  );
  // Strip helper meta from items
  const cleanedItems: ReturnItemResponse[] = items.map(
    ({ _exchangeMeta, ...rest }) => rest,
  );
  return {
    ...toReturnResponse(r, totalExchange),
    items: cleanedItems,
  };
}

