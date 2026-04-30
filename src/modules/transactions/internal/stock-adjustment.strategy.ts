import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Deduction } from "./transactions.helpers";

type Tx = Prisma.TransactionClient;

export interface StockAdjustmentStrategy {
  /** Throws BadRequest/NotFound bila stok < quantity untuk salah satu item. */
  validateAvailability(tx: Tx, deductions: Deduction[]): Promise<void>;

  /** Decrement stok sesuai deductions. Untuk strategy company-level, ikut menulis StockMovement. */
  deduct(tx: Tx, deductions: Deduction[], reference: string): Promise<void>;

  /** Increment stok kembali (void/refund). Strategy company-level menulis StockMovement IN. */
  restore(
    tx: Tx,
    items: Array<{ productId: string; quantity: number }>,
    reference: string,
    note: string,
  ): Promise<void>;
}

@Injectable()
export class BranchStockStrategy implements StockAdjustmentStrategy {
  constructor(private readonly branchId: string) {}

  static for(branchId: string): BranchStockStrategy {
    return new BranchStockStrategy(branchId);
  }

  async validateAvailability(tx: Tx, deductions: Deduction[]): Promise<void> {
    if (deductions.length === 0) return;
    const productIds = deductions.map((d) => d.productId);
    const stocks = await tx.branchStock.findMany({
      where: { branchId: this.branchId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    });
    const stockMap = new Map(stocks.map((s) => [s.productId, s.quantity]));
    for (const d of deductions) {
      const available = stockMap.get(d.productId) ?? 0;
      if (available < d.quantity) {
        throw new BadRequestException(
          `Stok ${d.productName} tidak mencukupi di cabang ini (sisa: ${available})`,
        );
      }
    }
  }

  async deduct(tx: Tx, deductions: Deduction[]): Promise<void> {
    if (deductions.length === 0) return;
    await Promise.all(
      deductions.map((d) =>
        tx.branchStock.update({
          where: {
            branchId_productId: { branchId: this.branchId, productId: d.productId },
          },
          data: { quantity: { decrement: d.quantity } },
        }),
      ),
    );
  }

  async restore(
    tx: Tx,
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await Promise.all(
      items.map((it) =>
        tx.branchStock.upsert({
          where: {
            branchId_productId: { branchId: this.branchId, productId: it.productId },
          },
          create: {
            branchId: this.branchId,
            productId: it.productId,
            quantity: it.quantity,
          },
          update: { quantity: { increment: it.quantity } },
        }),
      ),
    );
  }
}

@Injectable()
export class CompanyStockStrategy implements StockAdjustmentStrategy {
  constructor(private readonly companyId: string) {}

  static for(companyId: string): CompanyStockStrategy {
    return new CompanyStockStrategy(companyId);
  }

  async validateAvailability(tx: Tx, deductions: Deduction[]): Promise<void> {
    if (deductions.length === 0) return;
    const productIds = deductions.map((d) => d.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, companyId: this.companyId },
      select: { id: true, name: true, stock: true },
    });
    const stockMap = new Map(products.map((p) => [p.id, p]));
    for (const d of deductions) {
      const p = stockMap.get(d.productId);
      if (!p) {
        throw new NotFoundException(
          `Produk ${d.productName} tidak ditemukan`,
        );
      }
      if (p.stock < d.quantity) {
        throw new BadRequestException(
          `Stok ${d.productName} tidak mencukupi (sisa: ${p.stock})`,
        );
      }
    }
  }

  async deduct(tx: Tx, deductions: Deduction[], reference: string): Promise<void> {
    if (deductions.length === 0) return;
    await Promise.all(
      deductions.map((d) =>
        Promise.all([
          tx.product.update({
            where: { id: d.productId },
            data: { stock: { decrement: d.quantity } },
          }),
          tx.stockMovement.create({
            data: {
              productId: d.productId,
              branchId: null,
              type: "OUT",
              quantity: d.quantity,
              note: `Penjualan ${reference}`,
              reference,
            },
          }),
        ]),
      ),
    );
  }

  async restore(
    tx: Tx,
    items: Array<{ productId: string; quantity: number }>,
    reference: string,
    note: string,
  ): Promise<void> {
    if (items.length === 0) return;
    for (const it of items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { increment: it.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          productId: it.productId,
          branchId: null,
          type: "IN",
          quantity: it.quantity,
          note,
          reference,
        },
      });
    }
  }
}

export function pickStockStrategy(
  companyId: string,
  branchId: string | null,
): StockAdjustmentStrategy {
  return branchId
    ? BranchStockStrategy.for(branchId)
    : CompanyStockStrategy.for(companyId);
}
