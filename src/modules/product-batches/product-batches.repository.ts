import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// Shape konsisten untuk response batch.
export const BATCH_SELECT = {
  id: true,
  productId: true,
  productName: true,
  branchId: true,
  variantId: true,
  variantLabel: true,
  batchNumber: true,
  expiryDate: true,
  supplierId: true,
  supplierName: true,
  goodsReceiptId: true,
  receivedQty: true,
  remainingQty: true,
  unitCost: true,
  status: true,
  receivedAt: true,
} satisfies Prisma.ProductBatchSelect;

export type RawBatch = Prisma.ProductBatchGetPayload<{
  select: typeof BATCH_SELECT;
}>;

const MOVEMENT_SELECT = {
  id: true,
  batchId: true,
  type: true,
  direction: true,
  quantity: true,
  remainingAfter: true,
  refType: true,
  refId: true,
  refNumber: true,
  note: true,
  createdAt: true,
} satisfies Prisma.ProductBatchMovementSelect;

export type RawBatchMovement = Prisma.ProductBatchMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

const TRACE_TX_SELECT = {
  id: true,
  invoiceNumber: true,
  createdAt: true,
  customerId: true,
  customer: { select: { name: true, phone: true } },
} satisfies Prisma.TransactionSelect;

export type RawTraceTransaction = Prisma.TransactionGetPayload<{
  select: typeof TRACE_TX_SELECT;
}>;

@Injectable()
export class ProductBatchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(
    where: Prisma.ProductBatchWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBatch[]> {
    return this.prisma.productBatch.findMany({
      where,
      select: BATCH_SELECT,
      orderBy: [
        { expiryDate: { sort: "asc", nulls: "last" } },
        { receivedAt: "asc" },
      ],
      skip,
      take,
    });
  }

  count(where: Prisma.ProductBatchWhereInput): Promise<number> {
    return this.prisma.productBatch.count({ where });
  }

  async sumRemaining(where: Prisma.ProductBatchWhereInput): Promise<number> {
    const agg = await this.prisma.productBatch.aggregate({
      where,
      _sum: { remainingQty: true },
    });
    return agg._sum.remainingQty ?? 0;
  }

  // Batch yang dipakai trace/recall: by id atau seluruh batchNumber.
  findBatchesByRef(
    companyId: string,
    ref: { batchId?: string; batchNumber?: string },
  ): Promise<RawBatch[]> {
    const where: Prisma.ProductBatchWhereInput = { companyId };
    if (ref.batchId) where.id = ref.batchId;
    if (ref.batchNumber) where.batchNumber = ref.batchNumber;
    return this.prisma.productBatch.findMany({
      where,
      select: BATCH_SELECT,
      orderBy: { receivedAt: "asc" },
    });
  }

  // OUT movement untuk daftar batch (default: yang bersumber dari transaksi).
  findOutMovements(
    batchIds: string[],
    refType = "transaction",
  ): Promise<RawBatchMovement[]> {
    return this.prisma.productBatchMovement.findMany({
      where: { batchId: { in: batchIds }, direction: "OUT", refType },
      select: MOVEMENT_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  // Riwayat movement satu batch (audit ledger).
  findMovementsByBatch(
    batchId: string,
    skip: number,
    take: number,
  ): Promise<RawBatchMovement[]> {
    return this.prisma.productBatchMovement.findMany({
      where: { batchId },
      select: MOVEMENT_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  countMovementsByBatch(batchId: string): Promise<number> {
    return this.prisma.productBatchMovement.count({ where: { batchId } });
  }

  findTransactionsByIds(
    companyId: string,
    ids: string[],
  ): Promise<RawTraceTransaction[]> {
    return this.prisma.transaction.findMany({
      where: { id: { in: ids }, companyId },
      select: TRACE_TX_SELECT,
    });
  }

  // Recall: tandai batch RECALLED. Return jumlah batch + sisa qty yg ditarik.
  async recallBatches(
    companyId: string,
    ref: { batchId?: string; batchNumber?: string },
    reason: string,
    userId: string | null,
  ): Promise<{ recalledBatches: number; recalledRemainingQty: number }> {
    const where: Prisma.ProductBatchWhereInput = {
      companyId,
      status: { not: "RECALLED" },
    };
    if (ref.batchId) where.id = ref.batchId;
    if (ref.batchNumber) where.batchNumber = ref.batchNumber;

    return this.prisma.$transaction(async (tx) => {
      const targets = await tx.productBatch.findMany({
        where,
        select: { id: true, productId: true, branchId: true, remainingQty: true },
      });
      if (targets.length === 0) {
        return { recalledBatches: 0, recalledRemainingQty: 0 };
      }

      await tx.productBatch.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { status: "RECALLED" },
      });

      await tx.productBatchMovement.createMany({
        data: targets.map((t) => ({
          batchId: t.id,
          companyId,
          productId: t.productId,
          branchId: t.branchId,
          type: "RECALL",
          direction: "OUT",
          quantity: 0,
          remainingAfter: t.remainingQty,
          refType: "recall",
          note: `Recall: ${reason}`,
          createdBy: userId,
        })),
      });

      const recalledRemainingQty = targets.reduce(
        (sum, t) => sum + t.remainingQty,
        0,
      );
      return { recalledBatches: targets.length, recalledRemainingQty };
    });
  }
}
