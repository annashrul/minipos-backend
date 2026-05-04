import { Module } from "@nestjs/common";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";
import { RegisterController } from "./register.controller";
import { RegisterService } from "./register.service";

@Module({
  imports: [WhatsappReceiptModule],
  controllers: [RegisterController],
  providers: [RegisterService],
  exports: [RegisterService],
})
export class RegisterModule {}
