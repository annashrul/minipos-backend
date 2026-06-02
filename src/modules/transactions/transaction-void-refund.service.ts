import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import type {
  RefundTransactionResponse,
  SupervisorOverrideDto,
  VoidTransactionResponse,
} from "./dto/transactions.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RackStockHelperService } from "@/modules/racks/rack-stock-helper.service";
import { ProductBatchHelperService } from "@/modules/product-batches/product-batch-helper.service";
import { TransactionsRepository } from "./transactions.repository";

import { RealtimeService, EVENTS } from "@/modules/realtime/realtime.service";

@Injectable()
export class TransactionVoidRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: TransactionsRepository,
    private readonly realtime: RealtimeService,
    private readonly rackStockHelper: RackStockHelperService,
    private readonly batchHelper: ProductBatchHelperService,
  ) {}

  async voidTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
    actorRole?: string | null,
    override?: SupervisorOverrideDto | null,
  ): Promise<VoidTransactionResponse> {
    return this.changeStatusWithRestore(
      companyId,
      userId,
      id,
      reason,
      "VOIDED",
      actorRole ?? null,
      override ?? null,
    ) as Promise<VoidTransactionResponse>;
  }

  async refundTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
    actorRole?: string | null,
    override?: SupervisorOverrideDto | null,
  ): Promise<RefundTransactionResponse> {
    return this.changeStatusWithRestore(
      companyId,
      userId,
      id,
      reason,
      "REFUNDED",
      actorRole ?? null,
      override ?? null,
    ) as Promise<RefundTransactionResponse>;
  }

  /**
   * Role yang dianggap supervisor (boleh menyetujui/melakukan aksi sensitif).
   */
  private static readonly SUPERVISOR_ROLES = [
    "MANAGER",
    "ADMIN",
    "SUPER_ADMIN",
    "PLATFORM_OWNER",
  ];

  /**
   * Pastikan aksi void/refund terotorisasi. Bila actor sudah supervisor → lolos.
   * Bila bukan, butuh override supervisor (email+password, role MANAGER ke atas).
   * `actorRole` null = pemanggil internal (mis. void otomatis) → tanpa approval.
   * Verifikasi bcrypt CPU-bound → dipanggil SEBELUM membuka transaksi DB.
   *
   * @returns nama approver (untuk audit) atau null bila tanpa override.
   */
  private async ensureAuthorized(
    companyId: string,
    actorRole: string | null,
    override: SupervisorOverrideDto | null,
    noun: string,
  ): Promise<string | null> {
    if (!actorRole) return null; // internal/system call
    if (TransactionVoidRefundService.SUPERVISOR_ROLES.includes(actorRole)) {
      return null; // actor sudah supervisor
    }
    if (!override) {
      throw new BadRequestException(
        `${noun} memerlukan persetujuan supervisor`,
      );
    }
    const approver = await this.prisma.user.findFirst({
      where: { email: override.email, companyId, isActive: true },
      select: {
        name: true,
        role: true,
        password: true,
        authorizationPassword: true,
      },
    });
    if (
      !approver ||
      !TransactionVoidRefundService.SUPERVISOR_ROLES.includes(approver.role)
    ) {
      throw new ForbiddenException(
        "Persetujuan memerlukan role Manager ke atas",
      );
    }
    const hash = approver.authorizationPassword ?? approver.password;
    const valid = await bcrypt.compare(override.password, hash);
    if (!valid) throw new ForbiddenException("Password otorisasi salah");
    return approver.name;
  }

  private async changeStatusWithRestore(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
    target: "VOIDED" | "REFUNDED",
    actorRole: string | null = null,
    override: SupervisorOverrideDto | null = null,
  ): Promise<VoidTransactionResponse | RefundTransactionResponse> {
    const noun = target === "VOIDED" ? "Void" : "Refund";

    const existing = await this.repo.findByIdMinimal(companyId, id);
    if (!existing) throw new NotFoundException("Transaksi tidak ditemukan");

    // Otorisasi supervisor (di luar transaksi DB — bcrypt CPU-bound).
    const approverName = await this.ensureAuthorized(
      companyId,
      actorRole,
      override,
      noun,
    );

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!transaction) throw new NotFoundException("Transaksi tidak ditemukan");
      if (transaction.status !== "COMPLETED") {
        throw new BadRequestException(
          `Hanya transaksi COMPLETED yang bisa di-${noun.toLowerCase()}`,
        );
      }

      if (transaction.branchId) {
        await tx.$executeRaw`
          select
            set_config('app.stock_note', ${`${noun} transaksi ${transaction.invoiceNumber}`}, true),
            set_config('app.stock_reference', ${transaction.invoiceNumber}, true)
        `;
      }

      await Promise.all(
        transaction.items.map(async (item) => {
          const restoreQty =
            item.baseQty ?? item.quantity * (item.conversionQty ?? 1);
          if (transaction.branchId) {
            await tx.branchStock.upsert({
              where: {
                branchId_productId: {
                  branchId: transaction.branchId,
                  productId: item.productId,
                },
              },
              create: {
                branchId: transaction.branchId,
                productId: item.productId,
                quantity: restoreQty,
              },
              update: {
                quantity: { increment: restoreQty },
              },
            });
            // Phase 2B: restore RackStock ke rak default produk (kalau ada).
            // Void/refund tidak tahu rak asal pengambilan, jadi balikin ke
            // default rak — admin bisa adjust manual kalau perlu.
            await this.rackStockHelper.addToRack(tx, {
              branchId: transaction.branchId,
              productId: item.productId,
              qty: restoreQty,
              refType: "transaction",
              refId: transaction.id,
              userId: userId ?? null,
              notes: `${noun} transaksi ${transaction.invoiceNumber}`,
              movementType: target === "VOIDED" ? "VOID_RESTORE" : "REFUND_IN",
            });
            return;
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: restoreQty } },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              branchId: null,
              type: "IN",
              quantity: restoreQty,
              note: `${noun} transaksi ${transaction.invoiceNumber}`,
              reference: transaction.invoiceNumber,
            },
          });
        }),
      );

      // Pulihkan konsumsi batch FEFO (kalau ada produk trackBatch). No-op untuk
      // transaksi tanpa batch movement. Menjaga sum(batch.remaining) konsisten
      // dengan BranchStock yang baru dikembalikan.
      await this.batchHelper.restoreFefoForTransaction(tx, {
        companyId,
        transactionId: transaction.id,
        note: `${noun} transaksi ${transaction.invoiceNumber}`,
        createdBy: userId ?? null,
      });

      const updated = await tx.transaction.update({
        where: { id },
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
          userId,
          branchId: transaction.branchId,
          action: target === "VOIDED" ? "VOID" : "REFUND",
          entity: "Transaction",
          entityId: id,
          details:
            `${noun} ${transaction.invoiceNumber}: ${reason}` +
            (approverName ? ` (disetujui: ${approverName})` : ""),
        },
      });

      this.realtime.emit(
        target === "VOIDED" ? EVENTS.TRANSACTION_VOIDED : EVENTS.TRANSACTION_REFUNDED,
        {
          transactionId: updated.id,
          invoiceNumber: updated.invoiceNumber,
        },
        updated.branchId ?? undefined,
      );
      this.realtime.emit(EVENTS.STOCK_UPDATED, {}, updated.branchId ?? undefined);
      this.realtime.emit(EVENTS.DASHBOARD_REFRESH, {}, updated.branchId ?? undefined);

      return {
        id: updated.id,
        invoiceNumber: updated.invoiceNumber,
        status: updated.status as "VOIDED" | "REFUNDED",
        branchId: updated.branchId,
      } as VoidTransactionResponse | RefundTransactionResponse;
    });
  }
}
