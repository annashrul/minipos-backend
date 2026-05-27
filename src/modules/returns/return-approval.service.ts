import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import { tenantWhere } from "@/common/utils/tenant";
import type {
  RejectReturnDto,
  ReturnDetailResponse,
} from "./dto/returns.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ReturnsRepository, RETURN_DETAIL_SELECT } from "./returns.repository";
import { toReturnDetailResponse } from "./returns.helpers";

@Injectable()
export class ReturnApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReturnsRepository,
    private readonly assert: AssertService,
  ) {}

  async approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    // Approve = sekaligus complete: restock produk yg di-retur, decrement
    // produk pengganti (kalau EXCHANGE), terbitkan store credit (kalau ada).
    // Frontend hanya expose 1 tombol "Setujui", jadi tanpa langkah ini stok
    // tidak pernah balik ke gudang.
    const existing = await this.repo.findForApprove({
      id,
      ...tenantWhere(companyId, "transaction.user"),
    });
    if (!existing) throw new NotFoundException("Retur tidak ditemukan");
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
      // qty yg dibeli per produk -> transaksi pindah ke REFUNDED. Partial
      // return tetap dibiarkan COMPLETED -- modul retur jadi single source
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
    const existing = await this.repo.findForStatus({
      id,
      ...tenantWhere(companyId, "transaction.user"),
    });
    if (!existing) throw new NotFoundException("Retur tidak ditemukan");
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

    const updated = await this.repo.updateReturn(id, {
      status: "REJECTED",
      notes: newNotes,
      approvedBy: userId,
      approvedAt: new Date(),
    });
    return toReturnDetailResponse(updated);
  }

  async complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.repo.findForComplete({
      id,
      ...tenantWhere(companyId, "transaction.user"),
    });
    if (!existing) throw new NotFoundException("Retur tidak ditemukan");
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
