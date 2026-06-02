import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { paginate } from "@/common/utils/pagination";
import type { PaginatedResponse } from "@/common/types/response";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RackStockHelperService } from "@/modules/racks/rack-stock-helper.service";
import {
  ProductBatchesRepository,
  type RawBatch,
  type RawBatchMovement,
} from "./product-batches.repository";
import type {
  BatchMovementResponse,
  BatchResponse,
  BatchStatsQueryDto,
  BatchStatsResponse,
  BatchTraceQueryDto,
  BatchTraceResponse,
  BatchTraceSaleResponse,
  DisposeBatchDto,
  DisposeResultResponse,
  ExpiringBatchesQueryDto,
  ListBatchesQueryDto,
  RecallBatchDto,
  RecallResultResponse,
} from "./dto/product-batches.dto";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseBool(v: boolean | "true" | "false" | undefined): boolean {
  return v === true || v === "true";
}

@Injectable()
export class ProductBatchesService {
  constructor(
    private readonly repo: ProductBatchesRepository,
    private readonly prisma: PrismaService,
    private readonly rackStockHelper: RackStockHelperService,
  ) {}

  // Buang (write-off) batch kedaluwarsa: keluarkan sisa qty dari stok
  // (BranchStock + rak), catat sebagai WASTE di kartu stok, tandai batch
  // EXPIRED. Mengoreksi stok yang sebelumnya "menggantung" karena batch lewat
  // tanggal tidak boleh dijual.
  async dispose(
    companyId: string,
    userId: string | null,
    dto: DisposeBatchDto,
  ): Promise<DisposeResultResponse> {
    const batch = await this.prisma.productBatch.findFirst({
      where: { id: dto.batchId, companyId },
      select: {
        id: true,
        productId: true,
        productName: true,
        branchId: true,
        variantId: true,
        variantLabel: true,
        remainingQty: true,
        status: true,
        batchNumber: true,
      },
    });
    if (!batch) throw new NotFoundException("Batch tidak ditemukan");
    if (batch.status === "RECALLED") {
      throw new BadRequestException("Batch sudah ditarik (recall)");
    }
    if (batch.remainingQty <= 0) {
      throw new BadRequestException("Batch tidak punya sisa untuk dibuang");
    }

    const qty = batch.remainingQty;
    const note = dto.reason
      ? `Buang batch ${batch.batchNumber}: ${dto.reason}`
      : `Buang batch ${batch.batchNumber} (kedaluwarsa)`;

    await this.prisma.$transaction(async (tx) => {
      // 1. Habiskan sisa batch + tandai EXPIRED.
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { remainingQty: 0, status: "EXPIRED" },
      });
      await tx.productBatchMovement.create({
        data: {
          batchId: batch.id,
          companyId,
          productId: batch.productId,
          branchId: batch.branchId,
          type: "EXPIRE",
          direction: "OUT",
          quantity: qty,
          remainingAfter: 0,
          refType: "batch_disposal",
          refId: batch.id,
          note,
          createdBy: userId,
        },
      });

      // 2. Kurangi stok agregat + kartu stok (WASTE).
      let balanceAfter: number | null = null;
      if (batch.branchId) {
        const updated = await tx.branchStock.update({
          where: {
            branchId_productId: {
              branchId: batch.branchId,
              productId: batch.productId,
            },
          },
          data: { quantity: { decrement: qty } },
          select: { quantity: true },
        });
        balanceAfter = updated.quantity;
        await this.rackStockHelper.deductFromRacks(tx, {
          branchId: batch.branchId,
          productId: batch.productId,
          qty,
          refType: "batch_disposal",
          refId: batch.id,
          userId,
          notes: note,
          movementType: "WASTE",
        });
      } else {
        const updated = await tx.product.update({
          where: { id: batch.productId },
          data: { stock: { decrement: qty } },
          select: { stock: true },
        });
        balanceAfter = updated.stock;
      }

      await tx.stockMovement.create({
        data: {
          productId: batch.productId,
          branchId: batch.branchId,
          variantId: batch.variantId,
          variantLabel: batch.variantLabel,
          companyId,
          type: "WASTE",
          quantity: qty,
          direction: "OUT",
          balanceAfter,
          refType: "batch_disposal",
          refId: batch.id,
          note,
          reference: batch.batchNumber,
          createdBy: userId,
        },
      });
    });

    return { disposedQty: qty, status: "EXPIRED" };
  }

  async list(
    companyId: string,
    query: ListBatchesQueryDto,
  ): Promise<PaginatedResponse<BatchResponse>> {
    const { page, perPage, search, productId, branchId, status } = query;
    const where: Prisma.ProductBatchWhereInput = { companyId };
    if (productId) where.productId = productId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (parseBool(query.inStock)) where.remainingQty = { gt: 0 };
    if (search) {
      where.OR = [
        { batchNumber: { contains: search, mode: "insensitive" } },
        { productName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);
    return paginate(rows.map(toBatchResponse), total, page, perPage);
  }

  async expiring(
    companyId: string,
    query: ExpiringBatchesQueryDto,
  ): Promise<PaginatedResponse<BatchResponse>> {
    const { page, perPage, days, branchId } = query;
    const includeExpired = query.includeExpired === undefined
      ? true
      : parseBool(query.includeExpired);

    const now = new Date();
    const upper = new Date(now.getTime() + days * MS_PER_DAY);
    const expiryFilter: Prisma.DateTimeNullableFilter = { lte: upper };
    if (!includeExpired) expiryFilter.gte = now;

    const where: Prisma.ProductBatchWhereInput = {
      companyId,
      status: "ACTIVE",
      remainingQty: { gt: 0 },
      expiryDate: expiryFilter,
    };
    if (branchId) where.branchId = branchId;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);
    return paginate(rows.map(toBatchResponse), total, page, perPage);
  }

  async stats(
    companyId: string,
    query: BatchStatsQueryDto,
  ): Promise<BatchStatsResponse> {
    const { branchId, expiringDays } = query;
    const branchScope: Prisma.ProductBatchWhereInput = branchId
      ? { branchId }
      : {};
    const activeInStock: Prisma.ProductBatchWhereInput = {
      companyId,
      status: "ACTIVE",
      remainingQty: { gt: 0 },
      ...branchScope,
    };

    const now = new Date();
    const upper = new Date(now.getTime() + expiringDays * MS_PER_DAY);

    const [activeBatches, totalRemainingQty, expiringSoon, expired, recalled] =
      await Promise.all([
        this.repo.count(activeInStock),
        this.repo.sumRemaining(activeInStock),
        this.repo.count({
          ...activeInStock,
          expiryDate: { gte: now, lte: upper },
        }),
        this.repo.count({ ...activeInStock, expiryDate: { lt: now } }),
        this.repo.count({ companyId, status: "RECALLED", ...branchScope }),
      ]);

    return { activeBatches, totalRemainingQty, expiringSoon, expired, recalled };
  }

  async movements(
    batchId: string,
    page: number,
    perPage: number,
  ): Promise<PaginatedResponse<BatchMovementResponse>> {
    const [rows, total] = await Promise.all([
      this.repo.findMovementsByBatch(batchId, (page - 1) * perPage, perPage),
      this.repo.countMovementsByBatch(batchId),
    ]);
    return paginate(rows.map(toMovementResponse), total, page, perPage);
  }

  // Penelusuran recall: batch + transaksi penjualan yang memakai batch + daftar
  // pelanggan terdampak (untuk dihubungi).
  async trace(
    companyId: string,
    query: BatchTraceQueryDto,
  ): Promise<BatchTraceResponse> {
    if (!query.batchId && !query.batchNumber) {
      throw new BadRequestException("batchId atau batchNumber wajib diisi");
    }

    const batches = await this.repo.findBatchesByRef(companyId, {
      batchId: query.batchId,
      batchNumber: query.batchNumber,
    });
    if (batches.length === 0) {
      return { batches: [], sales: [], totalSoldQty: 0, affectedCustomers: 0 };
    }

    const outMovements = await this.repo.findOutMovements(
      batches.map((b) => b.id),
    );
    const txIds = [
      ...new Set(
        outMovements
          .filter((m) => m.refId)
          .map((m) => m.refId as string),
      ),
    ];
    const transactions = txIds.length
      ? await this.repo.findTransactionsByIds(companyId, txIds)
      : [];
    const txMap = new Map(transactions.map((t) => [t.id, t]));

    const sales: BatchTraceSaleResponse[] = [];
    const customerIds = new Set<string>();
    let totalSoldQty = 0;
    for (const m of outMovements) {
      if (!m.refId) continue;
      const tx = txMap.get(m.refId);
      totalSoldQty += m.quantity;
      if (tx?.customerId) customerIds.add(tx.customerId);
      sales.push({
        movementId: m.id,
        transactionId: m.refId,
        invoiceNumber: tx?.invoiceNumber ?? m.refNumber ?? null,
        quantity: m.quantity,
        soldAt: (tx?.createdAt ?? m.createdAt).toISOString(),
        customerId: tx?.customerId ?? null,
        customerName: tx?.customer?.name ?? null,
        customerPhone: tx?.customer?.phone ?? null,
      });
    }

    return {
      batches: batches.map(toBatchResponse),
      sales,
      totalSoldQty,
      affectedCustomers: customerIds.size,
    };
  }

  async recall(
    companyId: string,
    userId: string | null,
    dto: RecallBatchDto,
  ): Promise<RecallResultResponse> {
    if (!dto.batchId && !dto.batchNumber) {
      throw new BadRequestException("batchId atau batchNumber wajib diisi");
    }

    // Hitung dampak penjualan sebelum recall (untuk laporan ke user).
    const trace = await this.trace(companyId, {
      batchId: dto.batchId,
      batchNumber: dto.batchNumber,
      page: 1,
      perPage: 1,
    } as BatchTraceQueryDto);

    const result = await this.repo.recallBatches(
      companyId,
      { batchId: dto.batchId, batchNumber: dto.batchNumber },
      dto.reason,
      userId,
    );

    return {
      recalledBatches: result.recalledBatches,
      recalledRemainingQty: result.recalledRemainingQty,
      affectedSales: trace.sales.length,
    };
  }
}

// ── Mapping ────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: Date | null): number | null {
  if (!expiryDate) return null;
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  return Math.round((expiryDate.getTime() - startOfToday.getTime()) / MS_PER_DAY);
}

function toBatchResponse(b: RawBatch): BatchResponse {
  return {
    id: b.id,
    productId: b.productId,
    productName: b.productName,
    branchId: b.branchId,
    variantId: b.variantId,
    variantLabel: b.variantLabel,
    batchNumber: b.batchNumber,
    expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
    supplierId: b.supplierId,
    supplierName: b.supplierName,
    goodsReceiptId: b.goodsReceiptId,
    receivedQty: b.receivedQty,
    remainingQty: b.remainingQty,
    unitCost: b.unitCost != null ? Number(b.unitCost) : null,
    status: b.status,
    daysUntilExpiry: daysUntilExpiry(b.expiryDate),
    receivedAt: b.receivedAt.toISOString(),
  };
}

function toMovementResponse(m: RawBatchMovement): BatchMovementResponse {
  return {
    id: m.id,
    batchId: m.batchId,
    type: m.type,
    direction: m.direction,
    quantity: m.quantity,
    remainingAfter: m.remainingAfter,
    refType: m.refType,
    refId: m.refId,
    refNumber: m.refNumber,
    note: m.note,
    createdAt: m.createdAt.toISOString(),
  };
}
