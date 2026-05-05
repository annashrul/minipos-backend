import { Module } from "@nestjs/common";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";

@Module({
  imports: [WhatsappReceiptModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
