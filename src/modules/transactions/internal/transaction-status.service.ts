import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  RefundTransactionResponse,
  VoidTransactionResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { pickStockStrategy } from "./stock-adjustment.strategy";

type StatusTarget = "VOIDED" | "REFUNDED";

@Injectable()
export class TransactionStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  voidTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<VoidTransactionResponse> {
    return this.changeStatusWithRestore({
      companyId,
      actorId: userId,
      transactionId: id,
      reason,
      target: "VOIDED",
    }) as Promise<VoidTransactionResponse>;
  }

  refundTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<RefundTransactionResponse> {
    return this.changeStatusWithRestore({
      companyId,
      actorId: userId,
      transactionId: id,
      reason,
      target: "REFUNDED",
    }) as Promise<RefundTransactionResponse>;
  }

  private async changeStatusWithRestore(params: {
    companyId: string;
    actorId: string;
    transactionId: string;
    reason: string;
    target: StatusTarget;
  }): Promise<VoidTransactionResponse | RefundTransactionResponse> {
    const { companyId, actorId, transactionId, reason, target } = params;
    const noun = target === "VOIDED" ? "Void" : "Refund";

    const existing = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Transaction not found");

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { items: true },
      });
      if (!transaction) throw new NotFoundException("Transaction not found");
      if (transaction.status !== "COMPLETED") {
        throw new BadRequestException(
          `Hanya transaksi COMPLETED yang bisa di-${noun.toLowerCase()}`,
        );
      }

      // Stock-movement DB trigger reads these via current_setting().
      // Only set when the transaction had a branchId (matches legacy behavior).
      if (transaction.branchId) {
        await tx.$executeRaw`
          select
            set_config('app.stock_note', ${`${noun} transaksi ${transaction.invoiceNumber}`}, true),
            set_config('app.stock_reference', ${transaction.invoiceNumber}, true)
        `;
      }

      const restoreItems = transaction.items.map((item) => ({
        productId: item.productId,
        quantity: item.baseQty ?? item.quantity * (item.conversionQty ?? 1),
      }));

      const stockStrategy = pickStockStrategy(companyId, transaction.branchId);
      await stockStrategy.restore(
        tx,
        restoreItems,
        transaction.invoiceNumber,
        `${noun} transaksi ${transaction.invoiceNumber}`,
      );

      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: { status: target, voidReason: reason },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          branchId: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          branchId: transaction.branchId,
          action: target === "VOIDED" ? "VOID" : "REFUND",
          entity: "Transaction",
          entityId: transactionId,
          details: `${noun} ${transaction.invoiceNumber}: ${reason}`,
        },
      });

      const branchForEmit = updated.branchId ?? undefined;
      this.realtime.emit(
        target === "VOIDED"
          ? EVENTS.TRANSACTION_VOIDED
          : EVENTS.TRANSACTION_REFUNDED,
        { transactionId: updated.id, invoiceNumber: updated.invoiceNumber },
        branchForEmit,
      );
      this.realtime.emit(EVENTS.STOCK_UPDATED, {}, branchForEmit);
      this.realtime.emit(EVENTS.DASHBOARD_REFRESH, {}, branchForEmit);

      return {
        id: updated.id,
        invoiceNumber: updated.invoiceNumber,
        status: updated.status as StatusTarget,
        branchId: updated.branchId,
      } as VoidTransactionResponse | RefundTransactionResponse;
    });
  }
}
