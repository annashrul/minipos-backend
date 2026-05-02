import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { XenditClient, type XenditQrCode } from "./xendit.client";

type CreateQrInput = {
  companyId: string;
  transactionId?: string | null;
  amount: number;
  description?: string;
};

@Injectable()
export class XenditQrService {
  private readonly logger = new Logger(XenditQrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: XenditClient,
    private readonly realtime: RealtimeService,
  ) {}

  async createForTransaction(input: CreateQrInput) {
    if (input.amount <= 0) {
      throw new BadRequestException("Amount harus > 0");
    }
    if (input.transactionId) {
      const tx = await this.prisma.transaction.findFirst({
        where: { id: input.transactionId, user: { companyId: input.companyId } },
        select: { id: true },
      });
      if (!tx) throw new NotFoundException("Transaksi tidak ditemukan");
    }

    const externalId = input.transactionId
      ? `QR-${input.transactionId}`
      : `QR-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`;

    // Idempotent reuse
    const existing = await this.prisma.paymentOrder.findUnique({
      where: { externalId },
    });
    if (existing && existing.status === "PENDING") {
      const raw = (existing.rawCreate as Record<string, unknown>) ?? {};
      const qrString = typeof raw["qr_string"] === "string" ? (raw["qr_string"] as string) : null;
      return { order: existing, qrString };
    }

    const durationSec = Number(
      this.config.get<string>("XENDIT_QR_DURATION") ?? 900,
    );
    const expiresAt = new Date(Date.now() + durationSec * 1000).toISOString();

    const xenditRes = await this.client.createQrCode({
      reference_id: externalId,
      amount: Math.round(input.amount),
      currency: "IDR",
      expires_at: expiresAt,
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
        amount: xenditRes.amount ?? Math.round(input.amount),
        currency: xenditRes.currency,
        description: input.description ?? null,
        paymentMethod: "QRIS",
        paymentChannel: "QR_CODE",
        expiresAt: xenditRes.expires_at ? new Date(xenditRes.expires_at) : new Date(expiresAt),
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
      update: {
        providerOrderId: xenditRes.id,
        amount: xenditRes.amount ?? Math.round(input.amount),
        expiresAt: xenditRes.expires_at ? new Date(xenditRes.expires_at) : new Date(expiresAt),
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
    });

    this.realtime.emit(EVENTS.PAYMENT_ORDER_CREATED, {
      orderId: order.id,
      transactionId: order.transactionId,
    });

    this.maybeAutoSuccess(order.id, xenditRes.amount ?? Math.round(input.amount));

    return { order, qrString: xenditRes.qr_string };
  }

  /**
   * Dev/sandbox helper: kalau XENDIT_DEV_AUTO_SUCCESS=true, simulasikan
   * webhook PAID setelah delay singkat. Tidak pernah aktif di production
   * karena env ini tidak di-set di Cloud Run.
   */
  private maybeAutoSuccess(orderId: string, amount: number) {
    const enabled = String(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS") ?? "")
      .toLowerCase() === "true";
    if (!enabled) return;
    const delayMs = Number(this.config.get<string>("XENDIT_DEV_AUTO_SUCCESS_DELAY_MS") ?? 2000);
    setTimeout(() => {
      this.applyQrWebhook(orderId, {
        status: "SUCCEEDED",
        amount,
        _dev_auto_success: true,
      }).catch((err) => this.logger.warn(`Dev auto-success failed: ${String(err)}`));
    }, delayMs).unref?.();
  }

  /**
   * Apply QR webhook update. Xendit `qr.payment` event payload:
   * {
   *   event: "qr.payment",
   *   data: { qr_id, qr_code?: { reference_id }, status: "SUCCEEDED"|..., amount, payment_id, ... }
   * }
   * Atau payload langsung di top-level (tergantung versi). Service ini menerima
   * payload yang sudah di-extract di `data` field.
   */
  async applyQrWebhook(
    orderId: string,
    payload: Record<string, unknown>,
  ) {
    const rawStatus = String(payload.status ?? "").toUpperCase();
    const status =
      rawStatus === "SUCCEEDED" || rawStatus === "PAID" || rawStatus === "COMPLETED"
        ? "PAID"
        : rawStatus === "FAILED"
          ? "FAILED"
          : rawStatus === "EXPIRED"
            ? "EXPIRED"
            : "PENDING";

    const order = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        paidAt: status === "PAID" ? new Date() : undefined,
        rawCallback: payload as unknown as Prisma.InputJsonValue,
      },
    });

    if (status === "PAID" && order.transactionId) {
      await this.prisma.transaction.updateMany({
        where: { id: order.transactionId, status: "PENDING" },
        data: {
          status: "COMPLETED",
          paymentAmount: order.amount,
          changeAmount: 0,
        },
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

  async syncFromProvider(id: string, companyId: string) {
    const order = await this.findById(id, companyId);
    if (!order.providerOrderId) return order;
    const remote = await this.client.getQrCode(order.providerOrderId);
    // Note: GET QR doesn't return paid status — must rely on webhooks for that.
    // We just refresh expiry/amount.
    const updated = await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        amount: remote.amount ?? order.amount,
        expiresAt: remote.expires_at ? new Date(remote.expires_at) : order.expiresAt,
      },
    });
    return updated;
  }
}
