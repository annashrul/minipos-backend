import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import { XenditClient, type XenditInvoice } from "./xendit.client";

type CreateOrderInput = {
  companyId: string;
  transactionId?: string | null;
  amount: number;
  description?: string;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  // External ID custom — kalau tidak diberikan, generate `INV-${transactionId|timestamp-rand}`.
  externalId?: string;
  items?: { name: string; quantity: number; price: number; category?: string }[];
  // Filter metode di Xendit hosted page (mis. ["OVO","DANA"]).
  paymentMethods?: string[];
};

@Injectable()
export class XenditInvoiceService {
  private readonly logger = new Logger(XenditInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: XenditClient,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Buat invoice di Xendit + simpan PaymentOrder di DB. Idempotent terhadap
   * `externalId` — kalau sudah ada baris untuk externalId yang sama dan
   * status masih PENDING, return baris existing tanpa hit Xendit lagi.
   */
  async createForTransaction(input: CreateOrderInput) {
    if (input.amount <= 0) {
      throw new BadRequestException("Amount harus > 0");
    }
    if (input.transactionId) {
      const tx = await this.prisma.transaction.findFirst({
        where: { id: input.transactionId, user: { companyId: input.companyId } },
        select: { id: true, grandTotal: true, invoiceNumber: true },
      });
      if (!tx) throw new NotFoundException("Transaksi tidak ditemukan");
    }

    const externalId =
      input.externalId ??
      (input.transactionId
        ? `INV-${input.transactionId}`
        : `INV-${Date.now().toString(36).toUpperCase()}-${Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase()}`);

    // Idempotency: kalau order PENDING untuk externalId sama sudah ada, kembalikan
    const existing = await this.prisma.paymentOrder.findUnique({
      where: { externalId },
    });
    if (existing && existing.status === "PENDING") {
      this.logger.log(
        `Reuse existing PENDING PaymentOrder externalId=${externalId}`,
      );
      return existing;
    }

    const successUrl = this.config.get<string>("XENDIT_CALLBACK_SUCCESS_URL");
    const failureUrl = this.config.get<string>("XENDIT_CALLBACK_FAILURE_URL");
    const duration = Number(
      this.config.get<string>("XENDIT_INVOICE_DURATION") ?? 900,
    );

    const xenditRes = await this.client.createInvoice({
      external_id: externalId,
      amount: Math.round(input.amount),
      description: input.description ?? "Pembayaran POS",
      invoice_duration: duration,
      currency: "IDR",
      ...(input.customer?.name || input.customer?.email
        ? {
            customer: {
              ...(input.customer?.name
                ? { given_names: input.customer.name }
                : {}),
              ...(input.customer?.email
                ? { email: input.customer.email }
                : {}),
              ...(input.customer?.phone
                ? { mobile_number: input.customer.phone }
                : {}),
            },
          }
        : {}),
      ...(successUrl ? { success_redirect_url: successUrl } : {}),
      ...(failureUrl ? { failure_redirect_url: failureUrl } : {}),
      ...(input.items?.length ? { items: input.items } : {}),
      ...(input.paymentMethods?.length ? { payment_methods: input.paymentMethods } : {}),
    });

    const order = await this.prisma.paymentOrder.upsert({
      where: { externalId },
      create: {
        companyId: input.companyId,
        transactionId: input.transactionId ?? null,
        provider: "xendit",
        externalId,
        providerOrderId: xenditRes.id,
        status: this.mapStatus(xenditRes.status),
        amount: xenditRes.amount,
        currency: xenditRes.currency ?? "IDR",
        description: input.description ?? null,
        payerEmail: input.customer?.email ?? null,
        paymentUrl: xenditRes.invoice_url,
        expiresAt: xenditRes.expiry_date ? new Date(xenditRes.expiry_date) : null,
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
      update: {
        providerOrderId: xenditRes.id,
        status: this.mapStatus(xenditRes.status),
        amount: xenditRes.amount,
        paymentUrl: xenditRes.invoice_url,
        expiresAt: xenditRes.expiry_date ? new Date(xenditRes.expiry_date) : null,
        rawCreate: xenditRes as unknown as Prisma.InputJsonValue,
      },
    });

    this.realtime.emit(EVENTS.PAYMENT_ORDER_CREATED, {
      orderId: order.id,
      transactionId: order.transactionId,
      paymentUrl: order.paymentUrl,
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
    const remote = await this.client.getInvoice(order.providerOrderId);
    return this.applyProviderUpdate(order.id, remote);
  }

  /**
   * Apply update dari Xendit (callback webhook atau sync pull) ke DB.
   * Idempotent — repeat call dengan payload sama tidak menggandakan side-effect.
   */
  async applyProviderUpdate(
    orderId: string,
    remote: XenditInvoice | (Record<string, unknown> & { id?: string; status?: string }),
  ) {
    const status = this.mapStatus(String(remote.status ?? ""));
    const order = await this.prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status,
        providerOrderId:
          (remote as XenditInvoice).id ??
          (remote.id as string | undefined) ??
          undefined,
        paymentMethod:
          (remote as XenditInvoice).payment_method ?? undefined,
        paymentChannel:
          (remote as XenditInvoice).payment_channel ?? undefined,
        paidAt:
          (remote as XenditInvoice).paid_at
            ? new Date((remote as XenditInvoice).paid_at!)
            : undefined,
        rawCallback: remote as unknown as Prisma.InputJsonValue,
      },
    });

    if (status === "PAID" && order.transactionId) {
      // Finalize transaction kalau masih PENDING — set jadi COMPLETED.
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

  private mapStatus(
    raw: string,
  ):
    | "PENDING"
    | "PAID"
    | "EXPIRED"
    | "FAILED"
    | "CANCELLED" {
    const s = raw.toUpperCase();
    if (s === "PAID" || s === "SETTLED") return "PAID";
    if (s === "EXPIRED") return "EXPIRED";
    if (s === "STOPPED") return "CANCELLED";
    if (s === "FAILED") return "FAILED";
    return "PENDING";
  }
}
