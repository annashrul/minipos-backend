import { Module } from "@nestjs/common";
import { WhatsappReceiptController } from "./whatsapp-receipt.controller";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";

@Module({
  controllers: [WhatsappReceiptController],
  providers: [WhatsappReceiptService],
  exports: [WhatsappReceiptService],
})
export class WhatsappReceiptModule {}
