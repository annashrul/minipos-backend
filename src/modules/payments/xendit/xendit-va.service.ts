import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { XenditClient, type XenditVaBank, type XenditVirtualAccount } from "./xendit.client";

type CreateVaInput = {
  companyId: string;
  transactionId?: string | null;
  amount: number;
  bankCode: XenditVaBank;
  customerName: string;
  description?: string;
};

@Injectable()
export class XenditVaService {
  private readonly logger = new Logger(XenditVaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: XenditClient,
    private readonly realtime: RealtimeService,
  ) {}

  async createForTransaction(input: CreateVaInput) {
    if (input.amount <= 0) throw new BadRequestException("Amount harus > 0");
    if (!input.customerName?.trim()) {
      throw new BadRequestException("Nama customer wajib diisi untuk VA");
    }
    if (input.transactionId) {
      const tx = await this.prisma.transaction.findFirst({
        where: { id: input.transactionId, user: { companyId: input.companyId } },
        select: { id: true },
      });
      if (!tx) throw new NotFoundException("Transaksi tidak ditemukan");
    }

    const externalId = input.transactionId
      ? `VA-${input.transactionId}-${input.bankCode}`
      : `VA-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`;

    const existing = await this.prisma.paymentOrder.findUnique({
      where: { externalId },
    });
    if (existing && existing.status === "PENDING") {
      const raw = (existing.rawCreate as Record<string, unknown>) ?? {};
      return { order: existing, va: raw as unknown as XenditVirtualAccount };
    }

    const durationSec = Number(
      this.config.get<string>("XENDIT_VA_DURATION") ?? 86400, // default 24h
    );
    const expirationDate = new Date(Date.now() + durationSec * 1000).toISOString();

    const xenditRes = await this.client.createVirtualAccount({
      external_id: externalId,
      bank_code: input.bankCode,
      name: input.customerName.trim().slice(0, 50),
      expected_amount: Math.round(input.amount),
      is_closed: true,
      is_single_use: true,
      expiration_date: expirationDate,
    });

    const order = await this.prisma.paymentOrder.upsert({
      where: { externalId },
      create: {
        companyId: input.companyId,
        transactionId: input.transactionId ?? null,
        provider: "xendit",
        externalId,
        providerOrderId: xenditRes.id,
        status: "PENDING",
        amount: xenditRes.expected_amount ?? Math.round(input.amount),
        currency: xenditRes.currency,
        description: input.description ?? null,
        paymentMethod: "VA",
        paymentChannel: xenditRes.bank_code,
        expiresAt: xenditRes.expiration_date ? new Date(xenditRes.expiration_date) : new Date(expirationDate),
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
      update: {
        providerOrderId: xenditRes.id,
        amount: xenditRes.expected_amount ?? Math.round(input.amount),
        paymentChannel: xenditRes.bank_code,
        expiresAt: xenditRes.expiration_date ? new Date(xenditRes.expiration_date) : new Date(expirationDate),
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
    });

    this.realtime.emit(EVENTS.PAYMENT_ORDER_CREATED, {
      orderId: order.id,
      transactionId: order.transactionId,
    });

    this.maybeAutoSuccess(order.id, xenditRes.expected_amount ?? Math.round(input.amount));

    return { order, va: xenditRes };
  }

  private maybeAutoSuccess(orderId: string, amount: number) {
    const enabled = String(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS") ?? "")
      .toLowerCase() === "true";
    if (!enabled) return;
    const delayMs = Number(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS_DELAY_MS") ?? 2000);
    setTimeout(() => {
      this.applyVaWebhook(orderId, {
        amount,
        _dev_auto_success: true,
      }).catch((err) => this.logger.warn(`Dev auto-success failed: ${String(err)}`));
    }, delayMs).unref?.();
  }

  /**
   * Webhook `virtual_account.paid` payload (top-level, bukan wrapped):
   * {
   *   payment_id, callback_virtual_account_id, owner_id, external_id,
   *   account_number, bank_code, amount, transaction_timestamp, ...
   * }
   * Beberapa versi event uses `created` event juga, di-skip karena kita
   * peduli hanya pada paid.
   */
  async applyVaWebhook(orderId: string, payload: Record<string, unknown>) {
    // Webhook VA tidak punya status field eksplisit; kehadirannya = paid.
    const status = "PAID" as const;

    const order = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        paidAt: new Date(),
        rawCallback: payload as unknown as Prisma.InputJsonValue,
      },
    });

    if (order.transactionId) {
      await this.prisma.transaction.updateMany({
        where: { id: order.transactionId, status: "PENDING" },
        data: { status: "COMPLETED", paymentAmount: order.amount, changeAmount: 0 },
      });
    }

    this.realtime.emit(EVENTS.PAYMENT_ORDER_UPDATED, {
      orderId: order.id,
      transactionId: order.transactionId,
      status: order.status,
    });

    return order;
  }

  async findById(id: string, companyId: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { id, companyId },
    });
    if (!order) throw new NotFoundException("Payment order tidak ditemukan");
    return order;
  }
}
