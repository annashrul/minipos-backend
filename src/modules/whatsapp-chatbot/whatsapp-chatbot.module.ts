import { Module, forwardRef } from "@nestjs/common";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";
import { WhatsappChatbotController } from "./whatsapp-chatbot.controller";
import { WhatsappChatbotService } from "./whatsapp-chatbot.service";

@Module({
  // forwardRef untuk antisipasi WA receipt module nanti import balik
  // chatbot service (untuk hook inbound). Sekarang hook lewat callback
  // registry — lihat whatsapp-receipt.service.ts.
  imports: [forwardRef(() => WhatsappReceiptModule)],
  controllers: [WhatsappChatbotController],
  providers: [WhatsappChatbotService],
  exports: [WhatsappChatbotService],
})
export class WhatsappChatbotModule {}
