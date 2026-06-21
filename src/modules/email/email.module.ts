import { Global, Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { ReceiptEmailService } from "./receipt-email.service";
import { EmailController } from "./email.controller";

/**
 * Global agar `EmailService` bisa di-inject di modul mana pun tanpa import
 * berulang (mis. auth untuk reset password/OTP, transactions untuk kirim struk).
 */
@Global()
@Module({
  controllers: [EmailController],
  providers: [EmailService, ReceiptEmailService],
  exports: [EmailService],
})
export class EmailModule {}
