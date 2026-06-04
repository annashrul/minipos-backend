import { Module } from "@nestjs/common";
import { WhatsappReceiptController } from "./whatsapp-receipt.controller";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";
import { WhatsappMessageService } from "./whatsapp-message.service";
import { WhatsappReceiptFormatService } from "./whatsapp-receipt-format.service";
import { WaServiceSocketService } from "./wa-service-socket.service";
import { StockAlertService } from "./stock-alert.service";

@Module({
  controllers: [WhatsappReceiptController, WhatsappWebhookController],
  // Order matters untuk onModuleInit lifecycle: ReceiptService registered
  // dulu supaya saat SocketService open connections, ReceiptService sudah
  // siap menerima event handler calls.
  providers: [
    WhatsappMessageService,
    WhatsappReceiptFormatService,
    WhatsappReceiptService,
    WaServiceSocketService,
    StockAlertService,
  ],
  exports: [WhatsappReceiptService, StockAlertService],
})
export class WhatsappReceiptModule {}
