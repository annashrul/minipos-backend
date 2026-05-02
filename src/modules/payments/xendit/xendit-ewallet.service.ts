import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { XenditClient, type XenditEwalletChannel, type XenditEwalletCharge } from "./xendit.client";

type CreateEwalletInput = {
  companyId: string;
  transactionId?: string | null;
  amount: number;
  channelCode: XenditEwalletChannel;
  mobileNumber?: string;
  description?: string;
};

@Injectable()
export class XenditEwalletService {
  private readonly logger = new Logger(XenditEwalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: XenditClient,
    private readonly realtime: RealtimeService,
  ) {}

  async createForTransaction(input: CreateEwalletInput) {
    if (input.amount <= 0) throw new BadRequestException("Amount harus > 0");

    // OVO mensyaratkan nomor HP, channel lain redirect-based.
    if (input.channelCode === "ID_OVO" && !input.mobileNumber) {
      throw new BadRequestException("Nomor HP wajib diisi untuk pembayaran OVO");
    }
    if (input.transactionId) {
      const tx = await this.prisma.transaction.findFirst({
        where: { id: input.transactionId, user: { companyId: input.companyId } },
        select: { id: true },
      });
      if (!tx) throw new NotFoundException("Transaksi tidak ditemukan");
    }

    const externalId = input.transactionId
      ? `EW-${input.transactionId}-${input.channelCode}`
      : `EW-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`;

    const existing = await this.prisma.paymentOrder.findUnique({
      where: { externalId },
    });
    if (existing && existing.status === "PENDING") {
      const raw = (existing.rawCreate as Record<string, unknown>) ?? {};
      return { order: existing, charge: raw as unknown as XenditEwalletCharge };
    }

    const successUrl = this.config.get<string>("XENDIT_CALLBACK_SUCCESS_URL");
    const failureUrl = this.config.get<string>("XENDIT_CALLBACK_FAILURE_URL");

    const xenditRes = await this.client.createEwalletCharge({
      reference_id: externalId,
      amount: Math.round(input.amount),
      currency: "IDR",
      channel_code: input.channelCode,
      ...(input.mobileNumber ? { mobile_number: input.mobileNumber } : {}),
      ...(successUrl ? { success_redirect_url: successUrl } : {}),
      ...(failureUrl ? { failure_redirect_url: failureUrl } : {}),
    });

    const status = this.mapStatus(xenditRes.status);
    const order = await this.prisma.paymentOrder.upsert({
      where: { externalId },
      create: {
        companyId: input.companyId,
        transactionId: input.transactionId ?? null,
        provider: "xendit",
        externalId,
        providerOrderId: xenditRes.id,
        status,
        amount: xenditRes.charge_amount ?? Math.round(input.amount),
        currency: xenditRes.currency,
        description: input.description ?? null,
        paymentMethod: "EWALLET",
        paymentChannel: xenditRes.channel_code,
        paymentUrl:
          xenditRes.actions?.desktop_web_checkout_url ??
          xenditRes.actions?.mobile_web_checkout_url ??
          null,
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
      update: {
        providerOrderId: xenditRes.id,
        status,
        amount: xenditRes.charge_amount ?? Math.round(input.amount),
        paymentChannel: xenditRes.channel_code,
        paymentUrl:
          xenditRes.actions?.desktop_web_checkout_url ??
          xenditRes.actions?.mobile_web_checkout_url ??
          null,
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
    });

    this.realtime.emit(EVENTS.PAYMENT_ORDER_CREATED, {
      orderId: order.id,
      transactionId: order.transactionId,
    });

    this.maybeAutoSuccess(order.id, xenditRes.charge_amount ?? Math.round(input.amount));

    return { order, charge: xenditRes };
  }

  private maybeAutoSuccess(orderId: string, amount: number) {
    const enabled = String(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS") ?? "")
      .toLowerCase() === "true";
    if (!enabled) return;
    const delayMs = Number(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS_DELAY_MS") ?? 2000);
    setTimeout(() => {
      this.applyEwalletWebhook(orderId, {
        status: "SUCCEEDED",
        capture_amount: amount,
        _dev_auto_success: true,
      }).catch((err) => this.logger.warn(`Dev auto-success failed: ${String(err)}`));
    }, delayMs).unref?.();
  }

  async findById(id: string, companyId: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { id, companyId },
    });
    if (!order) throw new NotFoundException("Payment order tidak ditemukan");
    return order;
  }

  async syncFromProvider(id: string, companyId: string) {
    const order = await this.findById(id, companyId);
    if (!order.providerOrderId) return order;
    const remote = await this.client.getEwalletCharge(order.providerOrderId);
    return this.applyEwalletWebhook(order.id, remote as unknown as Record<string, unknown>);
  }

  /**
   * Apply E-Wallet webhook update. Xendit `ewallet.capture` event payload
   * (api-version 2021-04-12) berbentuk:
   * { event: "ewallet.capture", data: { id, reference_id, status, capture_amount, ... } }
   * Service ini menerima payload data (atau full charge object dari sync).
   */
  async applyEwalletWebhook(
    orderId: string,
    payload: Record<string, unknown>,
  ) {
    const status = this.mapStatus(String(payload.status ?? ""));

    const order = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        paidAt: status === "PAID" ? new Date() : undefined,
        failureReason:
          status === "FAILED" ? (payload.failure_code as string | null) ?? null : undefined,
        rawCallback: payload as unknown as Prisma.InputJsonValue,
      },
    });

    if (status === "PAID" && order.transactionId) {
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

  private mapStatus(raw: string): "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "CANCELLED" {
    const s = raw.toUpperCase();
    if (s === "SUCCEEDED" || s === "PAID" || s === "COMPLETED") return "PAID";
    if (s === "FAILED") return "FAILED";
    if (s === "VOIDED" || s === "REFUNDED") return "CANCELLED";
    if (s === "EXPIRED") return "EXPIRED";
    return "PENDING";
  }
}
