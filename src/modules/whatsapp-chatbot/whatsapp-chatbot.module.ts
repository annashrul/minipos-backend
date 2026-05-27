import { Module, forwardRef } from "@nestjs/common";
import { WhatsappReceiptModule } from "@/modules/whatsapp-receipt/whatsapp-receipt.module";
import { WhatsappChatbotController } from "./whatsapp-chatbot.controller";
import { WhatsappChatbotRepository } from "./whatsapp-chatbot.repository";
import { WhatsappChatbotService } from "./whatsapp-chatbot.service";

@Module({
  // forwardRef untuk antisipasi WA receipt module nanti import balik
  // chatbot service (untuk hook inbound). Sekarang hook lewat callback
  // registry — lihat whatsapp-receipt.service.ts.
  imports: [forwardRef(() => WhatsappReceiptModule)],
  controllers: [WhatsappChatbotController],
  providers: [WhatsappChatbotRepository, WhatsappChatbotService],
  exports: [WhatsappChatbotService],
})
export class WhatsappChatbotModule {}
