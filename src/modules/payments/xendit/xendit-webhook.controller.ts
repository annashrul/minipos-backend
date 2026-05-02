import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { XenditEwalletService } from "./xendit-ewallet.service";
import { XenditInvoiceService } from "./xendit-invoice.service";
import { XenditQrService } from "./xendit-qr.service";
import { XenditVaService } from "./xendit-va.service";
import { XenditWebhookGuard } from "./xendit-webhook.guard";

/**
 * Public endpoint untuk callback Xendit. JWT di-skip via @Public(), tapi
 * dilindungi `XenditWebhookGuard` (verify x-callback-token).
 */
type XenditWebhookBody = {
  // Top-level Invoice payload (legacy):
  id?: string;
  external_id?: string;
  user_id?: string;
  status?: string;
  payment_method?: string;
  payment_channel?: string;
  paid_amount?: number;
  paid_at?: string;
  description?: string;
  // Wrapped event payload (new APIs, e.g. qr.payment, ewallet.capture):
  event?: string;
  data?: {
    id?: string;
    qr_id?: string;
    qr_code?: { id?: string; reference_id?: string };
    reference_id?: string;
    external_id?: string;
    status?: string;
    amount?: number;
    payment_id?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

@Controller("payments/xendit")
export class XenditWebhookController {
  private readonly logger = new Logger(XenditWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: XenditInvoiceService,
    private readonly qrService: XenditQrService,
    private readonly ewalletService: XenditEwalletService,
    private readonly vaService: XenditVaService,
  ) {}

  @Public()
  @UseGuards(XenditWebhookGuard)
  @HttpCode(200)
  @Post("webhook")
  async webhook(@Body() body: XenditWebhookBody): Promise<{ ok: true }> {
    // Determine event type. Xendit `qr.payment` / `qr.payment.succeeded` events
    // have `data.qr_code.reference_id` (or `data.reference_id`). Invoices use
    // top-level `external_id`.
    const event = String(body.event ?? "").toLowerCase();
    const isQrEvent = event.startsWith("qr.") || (body.data && (body.data.qr_id || body.data.qr_code));
    const isEwalletEvent = event.startsWith("ewallet.") || event.startsWith("payment.ewallet");
    // Webhook VA tidak punya `event` field, tapi kalau ada `callback_virtual_account_id`
    // atau `bank_code` di top-level dengan amount, itu VA paid event.
    const isVaEvent =
      typeof body["callback_virtual_account_id"] === "string" ||
      (typeof body["bank_code"] === "string" && typeof body["payment_id"] === "string");

    let externalId: string | undefined;
    if (isQrEvent && body.data) {
      externalId =
        (body.data.qr_code?.reference_id as string | undefined) ??
        (body.data.reference_id as string | undefined) ??
        (body.data.external_id as string | undefined);
    } else if (isEwalletEvent && body.data) {
      externalId =
        (body.data.reference_id as string | undefined) ??
        (body.data.external_id as string | undefined);
    } else if (isVaEvent) {
      externalId = body.external_id;
    } else {
      externalId = body.external_id;
    }

    if (!externalId) {
      this.logger.warn(`Xendit webhook tanpa external_id — event=${event}`);
      return { ok: true };
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { externalId },
    });
    if (!order) {
      this.logger.warn(`Xendit webhook untuk externalId tidak dikenal: ${externalId}`);
      return { ok: true };
    }

    if (isQrEvent) {
      await this.qrService.applyQrWebhook(order.id, (body.data ?? {}) as Record<string, unknown>);
    } else if (isEwalletEvent) {
      await this.ewalletService.applyEwalletWebhook(order.id, (body.data ?? {}) as Record<string, unknown>);
    } else if (isVaEvent) {
      await this.vaService.applyVaWebhook(order.id, body as Record<string, unknown>);
    } else {
      await this.invoiceService.applyProviderUpdate(order.id, body);
    }
    return { ok: true };
  }
}
