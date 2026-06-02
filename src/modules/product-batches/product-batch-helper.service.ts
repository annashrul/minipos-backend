import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Helper batch/lot — dipakai modul lain (purchases/receive, transactions/
 * checkout, stock-opname) untuk sinkron ProductBatch saat BranchStock berubah.
 *
 * Design (mirror RackStockHelperService):
 *   - BranchStock tetap source of truth untuk TOTAL qty per produk per cabang.
 *   - ProductBatch adalah lapisan ADITIF: mencatat DARI batch mana qty berasal.
 *   - Hanya aktif untuk produk dgn Product.trackBatch = true. Untuk produk lain
 *     caller TIDAK memanggil helper ini (atau helper jadi no-op) → backward
 *     compatible dgn produk simple.
 *   - sum(ProductBatch.remainingQty) bisa ≤ BranchStock.quantity. Selisih =
 *     stok lama yang masuk sebelum batch-tracking diaktifkan ("untracked").
 *
 * Semua method menerima `tx` (Prisma transaction client) supaya atomic dgn
 * transaksi BranchStock yang memanggil.
 */
@Injectable()
export class ProductBatchHelperService {
  /**
   * Cek apakah produk di-track batch. Caller pakai ini untuk memutuskan
   * panggil addBatchOnReceive / consumeFefo atau skip.
   */
  async isBatchTracked(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<boolean> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { trackBatch: true },
    });
    return product?.trackBatch === true;
  }

  /**
   * Catat batch saat barang masuk (IN). Bila batch dgn (companyId, productId,
   * branchId, variantId, batchNumber) yang sama sudah ada → merge qty (tambah
   * receivedQty + remainingQty, refresh expiry/cost). Selain itu buat batch
   * baru. Selalu tulis movement IN untuk audit trail.
   */
  async addBatchOnReceive(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      productId: string;
      productName: string;
      branchId: string | null;
      variantId?: string | null;
      variantLabel?: string | null;
      batchNumber: string;
      expiryDate?: Date | null;
      supplierId?: string | null;
      supplierName?: string | null;
      goodsReceiptId?: string | null;
      qty: number;
      unitCost?: number | null;
      refType?: string;
      refId?: string | null;
      refNumber?: string | null;
      createdBy?: string | null;
    },
  ): Promise<{ batchId: string } | null> {
    const {
      companyId,
      productId,
      productName,
      branchId,
      variantId = null,
      variantLabel = null,
      batchNumber,
      expiryDate = null,
      supplierId = null,
      supplierName = null,
      goodsReceiptId = null,
      qty,
      unitCost = null,
      refType = "goods_receipt",
      refId = null,
      refNumber = null,
      createdBy = null,
    } = params;
    if (qty <= 0) return null;

    const existing = await tx.productBatch.findFirst({
      where: { companyId, productId, branchId, variantId, batchNumber },
      select: { id: true, remainingQty: true },
    });

    let batchId: string;
    let remainingAfter: number;
    if (existing) {
      const updated = await tx.productBatch.update({
        where: { id: existing.id },
        data: {
          receivedQty: { increment: qty },
          remainingQty: { increment: qty },
          status: "ACTIVE",
          // Refresh metadata terbaru (expiry/cost/supplier) bila dikirim.
          ...(expiryDate ? { expiryDate } : {}),
          ...(unitCost != null ? { unitCost } : {}),
          ...(supplierId ? { supplierId } : {}),
          ...(supplierName ? { supplierName } : {}),
          ...(goodsReceiptId ? { goodsReceiptId } : {}),
        },
        select: { id: true, remainingQty: true },
      });
      batchId = updated.id;
      remainingAfter = updated.remainingQty;
    } else {
      const created = await tx.productBatch.create({
        data: {
          companyId,
          productId,
          productName,
          branchId,
          variantId,
          variantLabel,
          batchNumber,
          expiryDate,
          supplierId,
          supplierName,
          goodsReceiptId,
          receivedQty: qty,
          remainingQty: qty,
          unitCost,
          status: "ACTIVE",
        },
        select: { id: true, remainingQty: true },
      });
      batchId = created.id;
      remainingAfter = created.remainingQty;
    }

    await tx.productBatchMovement.create({
      data: {
        batchId,
        companyId,
        productId,
        branchId,
        type: "IN",
        direction: "IN",
        quantity: qty,
        remainingAfter,
        refType,
        refId,
        refNumber,
        note: refNumber ? `Penerimaan ${refNumber}` : null,
        createdBy,
      },
    });

    return { batchId };
  }

  /**
   * Konsumsi qty secara FEFO (First Expired First Out) saat barang keluar
   * (OUT, mis. penjualan). Mengurangi remainingQty batch dgn expiry paling
   * dekat dulu (NULL expiry = paling akhir), lalu yang lebih lama diterima.
   * Tulis movement OUT per batch (jejak recall: batch X keluar di refId mana).
   *
   * @returns consumed (qty yang berhasil dialokasikan ke batch) + shortfall
   *   (qty yang tidak tercover batch — dianggap stok untracked, caller TIDAK
   *   perlu rollback, identik filosofi rack helper).
   */
  async consumeFefo(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      productId: string;
      branchId: string | null;
      variantId?: string | null;
      qty: number;
      refType: string;
      refId?: string | null;
      refNumber?: string | null;
      note?: string | null;
      createdBy?: string | null;
    },
  ): Promise<{ consumed: number; shortfall: number; batchIds: string[] }> {
    const {
      companyId,
      productId,
      branchId,
      variantId = null,
      qty,
      refType,
      refId = null,
      refNumber = null,
      note = null,
      createdBy = null,
    } = params;
    if (qty <= 0) return { consumed: 0, shortfall: 0, batchIds: [] };

    // FEFO sejati: konsumsi batch dengan expiry TERDEKAT yang BELUM kedaluwarsa.
    // Batch yang sudah lewat tanggal (expiryDate < awal hari ini) TIDAK boleh
    // dijual — harus dibuang (disposal) lebih dulu. Batch tanpa expiry (null)
    // selalu boleh dikonsumsi (paling akhir).
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const batches = await tx.productBatch.findMany({
      where: {
        companyId,
        productId,
        branchId,
        variantId,
        status: "ACTIVE",
        remainingQty: { gt: 0 },
        OR: [{ expiryDate: null }, { expiryDate: { gte: startOfToday } }],
      },
      select: { id: true, remainingQty: true },
      orderBy: [
        { expiryDate: { sort: "asc", nulls: "last" } },
        { receivedAt: "asc" },
      ],
    });
    if (batches.length === 0) {
      return { consumed: 0, shortfall: qty, batchIds: [] };
    }

    let remaining = qty;
    let consumed = 0;
    const batchIds: string[] = [];
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.remainingQty, remaining);
      const newRemaining = batch.remainingQty - take;
      await tx.productBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: newRemaining,
          ...(newRemaining === 0 ? { status: "DEPLETED" } : {}),
        },
      });
      await tx.productBatchMovement.create({
        data: {
          batchId: batch.id,
          companyId,
          productId,
          branchId,
          type: "OUT",
          direction: "OUT",
          quantity: take,
          remainingAfter: newRemaining,
          refType,
          refId,
          refNumber,
          note,
          createdBy,
        },
      });
      remaining -= take;
      consumed += take;
      batchIds.push(batch.id);
    }

    return { consumed, shortfall: Math.max(remaining, 0), batchIds };
  }

  /**
   * Kembalikan konsumsi batch saat transaksi di-void/refund. Membaca ledger
   * OUT (refType="transaction", refId=transactionId) hasil consumeFefo, lalu
   * menambah kembali remainingQty batch yang sama + tulis movement IN reversal.
   *
   * No-op bila transaksi tidak punya batch movement (produk non-trackBatch).
   * Batch yang sudah RECALLED/EXPIRED (ditarik/dibuang) TIDAK dipulihkan supaya
   * stok bermasalah tidak hidup lagi.
   */
  async restoreFefoForTransaction(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      transactionId: string;
      note?: string | null;
      createdBy?: string | null;
    },
  ): Promise<{ restoredQty: number; skippedQty: number }> {
    const { companyId, transactionId, note = null, createdBy = null } = params;

    const outs = await tx.productBatchMovement.findMany({
      where: {
        refType: "transaction",
        refId: transactionId,
        direction: "OUT",
      },
      select: { batchId: true, quantity: true, productId: true, branchId: true },
    });
    if (outs.length === 0) return { restoredQty: 0, skippedQty: 0 };

    let restoredQty = 0;
    let skippedQty = 0;
    for (const m of outs) {
      const batch = await tx.productBatch.findUnique({
        where: { id: m.batchId },
        select: { remainingQty: true, status: true },
      });
      if (!batch) {
        skippedQty += m.quantity;
        continue;
      }
      // Jangan hidupkan kembali stok yang sudah ditarik/dibuang.
      if (batch.status === "RECALLED" || batch.status === "EXPIRED") {
        skippedQty += m.quantity;
        continue;
      }
      const remainingAfter = batch.remainingQty + m.quantity;
      await tx.productBatch.update({
        where: { id: m.batchId },
        data: {
          remainingQty: remainingAfter,
          ...(batch.status === "DEPLETED" ? { status: "ACTIVE" } : {}),
        },
      });
      await tx.productBatchMovement.create({
        data: {
          batchId: m.batchId,
          companyId,
          productId: m.productId,
          branchId: m.branchId,
          type: "IN",
          direction: "IN",
          quantity: m.quantity,
          remainingAfter,
          refType: "transaction_reversal",
          refId: transactionId,
          note,
          createdBy,
        },
      });
      restoredQty += m.quantity;
    }
    return { restoredQty, skippedQty };
  }
}
