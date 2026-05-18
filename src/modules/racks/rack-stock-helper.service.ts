import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

/**
 * Phase 2B helper — dipakai modul lain (transactions, purchases, stock-opname,
 * stock-adjustment) untuk sinkron RackStock saat BranchStock berubah.
 *
 * Design:
 *   - BranchStock tetap source of truth untuk TOTAL stok per produk per cabang.
 *   - RackStock adalah SUBSET (di mana di gudang stok itu).
 *   - sum(RackStock) bisa ≤ BranchStock. Selisih = "unassigned" (belum ditaruh
 *     di rak manapun, mis. baru terima barang tanpa pilih rak).
 *   - Kalau produk tidak punya entry RackStock sama sekali → "no rack tracking"
 *     mode (legacy/simple inventory) — helper jadi no-op.
 *
 * Semua method menerima `tx` (Prisma transaction client) supaya operasi
 * atomic dengan transaksi BranchStock yang manggil.
 */
@Injectable()
export class RackStockHelperService {
  /**
   * Kurangi RackStock saat barang keluar (penjualan, transfer keluar, dst).
   * FIFO: prefer default rak (product.defaultRackId), fallback rak lain yang
   * masih punya qty > 0 (urut qty desc → habiskan rak yang banyak dulu).
   *
   * @returns qty actual yang berhasil dikurangi dari rak. Bila < qty, sisanya
   *   dianggap "unassigned" — caller tidak perlu rollback.
   */
  async deductFromRacks(
    tx: Prisma.TransactionClient,
    params: {
      branchId: string;
      productId: string;
      qty: number;
      refType: string;
      refId?: string | null;
      userId?: string | null;
      notes?: string | null;
      movementType?: string;
    },
  ): Promise<number> {
    const {
      branchId,
      productId,
      qty,
      refType,
      refId,
      userId,
      notes,
      movementType = "SALE",
    } = params;
    if (qty <= 0) return 0;

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { defaultRackId: true },
    });

    const stocks = await tx.rackStock.findMany({
      where: { branchId, productId, qty: { gt: 0 } },
      select: { id: true, rackId: true, qty: true },
    });
    if (stocks.length === 0) return 0;

    stocks.sort((a, b) => {
      if (a.rackId === product?.defaultRackId) return -1;
      if (b.rackId === product?.defaultRackId) return 1;
      return b.qty - a.qty;
    });

    let remaining = qty;
    let deducted = 0;
    for (const stock of stocks) {
      if (remaining <= 0) break;
      const take = Math.min(stock.qty, remaining);
      const newQty = stock.qty - take;
      if (newQty === 0) {
        await tx.rackStock.delete({ where: { id: stock.id } });
      } else {
        await tx.rackStock.update({
          where: { id: stock.id },
          data: { qty: newQty },
        });
      }
      await tx.rackStockMovement.create({
        data: {
          productId,
          branchId,
          fromRackId: stock.rackId,
          qty: take,
          type: movementType,
          refType,
          ...(refId ? { refId } : {}),
          ...(userId ? { byUserId: userId } : {}),
          ...(notes ? { notes } : {}),
        },
      });
      remaining -= take;
      deducted += take;
    }
    return deducted;
  }

  /**
   * Tambah RackStock saat barang masuk (terima PO, retur masuk, dst).
   *
   * Behavior:
   *   - rackId eksplisit → tambah ke rak itu.
   *   - rackId null/undefined → fallback ke product.defaultRackId.
   *   - product tidak punya defaultRackId → no-op (qty masuk sbg "unassigned"
   *     di BranchStock).
   */
  async addToRack(
    tx: Prisma.TransactionClient,
    params: {
      branchId: string;
      productId: string;
      qty: number;
      rackId?: string | null;
      refType: string;
      refId?: string | null;
      userId?: string | null;
      notes?: string | null;
      movementType?: string;
    },
  ): Promise<{ rackId: string | null; added: number }> {
    const {
      branchId,
      productId,
      qty,
      refType,
      refId,
      userId,
      notes,
      movementType = "RECEIPT",
    } = params;
    if (qty <= 0) return { rackId: null, added: 0 };

    let targetRackId = params.rackId ?? null;
    if (!targetRackId) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { defaultRackId: true },
      });
      targetRackId = product?.defaultRackId ?? null;
    }
    if (!targetRackId) return { rackId: null, added: 0 };

    // Validate rak ada di cabang yang sama.
    const rack = await tx.rack.findFirst({
      where: { id: targetRackId, branchId },
      select: { id: true },
    });
    if (!rack) return { rackId: null, added: 0 };

    await tx.rackStock.upsert({
      where: { rackId_productId: { rackId: targetRackId, productId } },
      update: { qty: { increment: qty } },
      create: { rackId: targetRackId, productId, branchId, qty },
    });
    await tx.rackStockMovement.create({
      data: {
        productId,
        branchId,
        toRackId: targetRackId,
        qty,
        type: movementType,
        refType,
        ...(refId ? { refId } : {}),
        ...(userId ? { byUserId: userId } : {}),
        ...(notes ? { notes } : {}),
      },
    });
    return { rackId: targetRackId, added: qty };
  }

  /**
   * Adjustment / opname: set qty produk di rak tertentu (delta logged).
   * Return delta (positif = nambah, negatif = ngurangin).
   */
  async setRackQty(
    tx: Prisma.TransactionClient,
    params: {
      branchId: string;
      productId: string;
      rackId: string;
      qty: number;
      refType: string;
      refId?: string | null;
      userId?: string | null;
      notes?: string | null;
      movementType?: string;
    },
  ): Promise<{ delta: number }> {
    const {
      branchId,
      productId,
      rackId,
      qty,
      refType,
      refId,
      userId,
      notes,
      movementType = "OPNAME_ADJUSTMENT",
    } = params;
    if (qty < 0) return { delta: 0 };

    const existing = await tx.rackStock.findUnique({
      where: { rackId_productId: { rackId, productId } },
      select: { qty: true },
    });
    const oldQty = existing?.qty ?? 0;
    const delta = qty - oldQty;
    if (delta === 0) return { delta: 0 };

    if (qty === 0) {
      if (existing) {
        await tx.rackStock.delete({
          where: { rackId_productId: { rackId, productId } },
        });
      }
    } else {
      await tx.rackStock.upsert({
        where: { rackId_productId: { rackId, productId } },
        update: { qty },
        create: { rackId, productId, branchId, qty },
      });
    }
    await tx.rackStockMovement.create({
      data: {
        productId,
        branchId,
        toRackId: delta > 0 ? rackId : null,
        fromRackId: delta < 0 ? rackId : null,
        qty: Math.abs(delta),
        type: movementType,
        refType,
        ...(refId ? { refId } : {}),
        ...(userId ? { byUserId: userId } : {}),
        ...(notes ? { notes } : {}),
      },
    });
    return { delta };
  }

  /**
   * Cek apakah produk ini "tracked by rack" — kalau ada minimal 1 RackStock
   * entry untuk branch+product, atau product.defaultRackId di branch itu.
   * Caller pakai ini buat decide perlu panggil deductFromRacks atau skip.
   */
  async isRackTracked(
    tx: Prisma.TransactionClient,
    branchId: string,
    productId: string,
  ): Promise<boolean> {
    const [stock, product] = await Promise.all([
      tx.rackStock.findFirst({
        where: { branchId, productId },
        select: { id: true },
      }),
      tx.product.findUnique({
        where: { id: productId },
        select: { defaultRackId: true },
      }),
    ]);
    if (stock) return true;
    if (!product?.defaultRackId) return false;
    const defaultRack = await tx.rack.findFirst({
      where: { id: product.defaultRackId, branchId },
      select: { id: true },
    });
    return !!defaultRack;
  }
}
