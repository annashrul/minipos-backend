import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type StockAdjustment = {
  productId: string;
  branchId: string | null;
  delta: number;
  reference: string;
  note: string;
  type: "IN" | "OUT";
  createdBy: string;
};

/**
 * Stateless helper untuk mutasi stok dari modul returns/exchange.
 * Berbeda dengan StockAdjustmentStrategy di transactions: butuh `createdBy`
 * dan signed-delta semantik (positive=IN, negative=OUT) — sesuai legacy
 * `adjustStock()` di ReturnsService lama.
 */
@Injectable()
export class ReturnStockAdjuster {
  async apply(tx: Tx, adj: StockAdjustment): Promise<void> {
    const absQty = Math.abs(adj.delta);
    if (absQty === 0) return;

    if (adj.branchId) {
      await tx.branchStock.upsert({
        where: {
          branchId_productId: {
            branchId: adj.branchId,
            productId: adj.productId,
          },
        },
        create: {
          branchId: adj.branchId,
          productId: adj.productId,
          quantity: Math.max(adj.delta, 0),
        },
        update: {
          quantity:
            adj.delta >= 0 ? { increment: absQty } : { decrement: absQty },
        },
      });
    } else {
      await tx.product.update({
        where: { id: adj.productId },
        data: {
          stock:
            adj.delta >= 0 ? { increment: absQty } : { decrement: absQty },
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        productId: adj.productId,
        branchId: adj.branchId,
        type: adj.type,
        quantity: absQty,
        note: adj.note,
        reference: adj.reference,
        createdBy: adj.createdBy,
      },
    });
  }
}
