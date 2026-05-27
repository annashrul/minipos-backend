import { Injectable } from "@nestjs/common";
import { Prisma, StockMovementType } from "@prisma/client";
import { round2 } from "@/common/utils/math";
import { PrismaService } from "@/modules/prisma/prisma.service";

/**
 * Tipe transaksi yg dipakai service ledger. Bukan langsung enum Prisma karena
 * level enum dB include legacy values (IN/OUT/ADJUSTMENT/TRANSFER/OPNAME) yg
 * tidak boleh dipakai writer baru — service ke depan wajib pakai granular type.
 */
export type LedgerType =
  | "PURCHASE_RECEIVE"
  | "SALE"
  | "RETURN_IN"
  | "RETURN_OUT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "OPNAME_ADJUSTMENT"
  | "WASTE"
  | "RECIPE_DEDUCT"
  | "MANUAL_IN"
  | "MANUAL_OUT"
  | "RTV";

/**
 * Mapping LedgerType ke direction. Direction disimpan eksplisit di kolom
 * supaya kartu stok bisa SUM(CASE direction='IN' THEN quantity ELSE -quantity END)
 * tanpa CASE WHEN type IN (...).
 */
const DIRECTION_MAP: Record<LedgerType, "IN" | "OUT"> = {
  PURCHASE_RECEIVE: "IN",
  SALE: "OUT",
  RETURN_IN: "IN",
  RETURN_OUT: "OUT",
  TRANSFER_OUT: "OUT",
  TRANSFER_IN: "IN",
  OPNAME_ADJUSTMENT: "IN", // dihitung pakai signed; lihat RecordPayload.delta
  WASTE: "OUT",
  RECIPE_DEDUCT: "OUT",
  MANUAL_IN: "IN",
  MANUAL_OUT: "OUT",
  RTV: "OUT",
};

export interface RecordPayload {
  /** Granular movement type. Selalu pakai value baru, jangan pakai enum legacy. */
  type: LedgerType;
  /** Cabang lokasi mutasi. Wajib utk row baru — semua mutasi punya konteks cabang. */
  branchId: string;
  companyId: string;
  productId: string;
  /**
   * Magnitude positif. Direction (IN/OUT) ditentukan dari `type`. Untuk
   * OPNAME_ADJUSTMENT yg bisa naik/turun, pakai field `delta` (signed) untuk
   * menentukan direction & quantity sekaligus.
   */
  quantity?: number;
  /** Signed delta — alternatif untuk quantity. Positif = IN, negatif = OUT. */
  delta?: number;
  unitCost?: number;
  refType?: string;
  refId?: string;
  refNumber?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

/**
 * StockLedgerService — single source of truth untuk semua mutasi stok.
 *
 * Semua tempat yang dulu langsung `tx.branchStock.update` + `tx.stockMovement.create`
 * harus dirouting lewat `record(tx, payload)`. Service ini:
 *   1. Validasi konteks (sign/quantity/delta sinkron dgn direction)
 *   2. Update BranchStock atomically (sebagai bagian dari $tx caller)
 *   3. Hitung balanceAfter dari movement terakhir per (branch, product)
 *   4. Insert StockMovement dengan semua kolom ledger ter-isi
 *
 * IMPORTANT: caller WAJIB membungkus pemanggilan dalam `prisma.$transaction`
 * dan meneruskan `tx` (TransactionClient). Ini mencegah race condition pada
 * running balance.
 */
@Injectable()
export class StockLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catat 1 movement + update branch_stock dalam transaction yg sudah berjalan.
   * Return movement record yang baru dibuat (sudah include balanceAfter).
   */
  async record(
    tx: Prisma.TransactionClient,
    payload: RecordPayload,
  ): Promise<{
    id: string;
    balanceAfter: number;
    direction: "IN" | "OUT";
    quantity: number;
  }> {
    const {
      type,
      branchId,
      companyId,
      productId,
      unitCost,
      refType,
      refId,
      refNumber,
      note,
      createdBy,
    } = payload;

    // Resolve quantity + direction. Prioritas: delta (signed) → quantity + type.
    let quantity: number;
    let direction: "IN" | "OUT";
    if (payload.delta !== undefined && payload.delta !== null) {
      const d = Math.trunc(payload.delta);
      if (d === 0) {
        throw new Error(
          "StockLedger: delta=0 tidak boleh dicatat (no-op movement)",
        );
      }
      quantity = Math.abs(d);
      direction = d > 0 ? "IN" : "OUT";
    } else if (payload.quantity !== undefined && payload.quantity !== null) {
      const q = Math.trunc(payload.quantity);
      if (q <= 0) {
        throw new Error("StockLedger: quantity harus positif");
      }
      quantity = q;
      direction = DIRECTION_MAP[type];
    } else {
      throw new Error("StockLedger: payload wajib punya quantity atau delta");
    }

    const totalCost =
      unitCost !== undefined && unitCost !== null
        ? round2(unitCost * quantity)
        : null;

    // Update branch_stock — increment/decrement sesuai direction.
    // Pakai upsert supaya pertama kali masuk produk juga ter-handle.
    const stockDelta = direction === "IN" ? quantity : -quantity;
    const upserted = await tx.branchStock.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        quantity: stockDelta,
      },
      update: { quantity: { increment: stockDelta } },
      select: { quantity: true },
    });
    const balanceAfter = upserted.quantity;

    const movement = await tx.stockMovement.create({
      data: {
        type: type as StockMovementType,
        productId,
        branchId,
        companyId,
        quantity,
        direction,
        balanceAfter,
        ...(unitCost !== undefined && unitCost !== null
          ? { unitCost: new Prisma.Decimal(unitCost) }
          : {}),
        ...(totalCost !== null ? { totalCost: new Prisma.Decimal(totalCost) } : {}),
        ...(refType ? { refType } : {}),
        ...(refId ? { refId } : {}),
        ...(refNumber ? { refNumber, reference: refNumber } : {}),
        ...(note ? { note } : {}),
        ...(createdBy ? { createdBy } : {}),
      },
      select: { id: true, balanceAfter: true, direction: true, quantity: true },
    });

    return {
      id: movement.id,
      balanceAfter: movement.balanceAfter ?? balanceAfter,
      direction: (movement.direction as "IN" | "OUT") ?? direction,
      quantity: movement.quantity,
    };
  }

  /**
   * Helper untuk dipakai di luar transaction (one-off mutasi sederhana).
   * Internal-nya membuka $transaction sendiri.
   */
  async recordStandalone(payload: RecordPayload) {
    return this.prisma.$transaction((tx) => this.record(tx, payload));
  }
}
