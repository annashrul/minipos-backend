import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller";
import { XenditClient } from "./xendit/xendit.client";
import { XenditEwalletService } from "./xendit/xendit-ewallet.service";
import { XenditInvoiceService } from "./xendit/xendit-invoice.service";
import { XenditQrService } from "./xendit/xendit-qr.service";
import { XenditVaService } from "./xendit/xendit-va.service";
import { XenditWebhookController } from "./xendit/xendit-webhook.controller";
import { XenditWebhookGuard } from "./xendit/xendit-webhook.guard";

@Module({
  controllers: [PaymentsController, XenditWebhookController],
  providers: [
    XenditClient,
    XenditInvoiceService,
    XenditQrService,
    XenditEwalletService,
    XenditVaService,
    XenditWebhookGuard,
  ],
  exports: [
    XenditInvoiceService,
    XenditQrService,
    XenditEwalletService,
    XenditVaService,
  ],
})
export class PaymentsModule {}
