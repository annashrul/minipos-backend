import { Module } from "@nestjs/common";
import { WhatsappReceiptController } from "./whatsapp-receipt.controller";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";
import { WaServiceSocketService } from "./wa-service-socket.service";

@Module({
  controllers: [WhatsappReceiptController, WhatsappWebhookController],
  // Order matters untuk onModuleInit lifecycle: ReceiptService registered
  // dulu supaya saat SocketService open connections, ReceiptService sudah
  // siap menerima event handler calls.
  providers: [WhatsappReceiptService, WaServiceSocketService],
  exports: [WhatsappReceiptService],
})
export class WhatsappReceiptModule {}
