import { Module } from "@nestjs/common";
import { BookingsController } from "./bookings.controller";
import { BookingsRepository } from "./bookings.repository";
import { BookingsService } from "./bookings.service";
import { WhatsappReceiptModule } from "@/modules/whatsapp-receipt/whatsapp-receipt.module";

@Module({
  imports: [WhatsappReceiptModule],
  controllers: [BookingsController],
  providers: [BookingsRepository, BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
