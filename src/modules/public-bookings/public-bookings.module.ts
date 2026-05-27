import { Module } from "@nestjs/common";
import { BookingsModule } from "@/modules/bookings/bookings.module";
import { WhatsappReceiptModule } from "@/modules/whatsapp-receipt/whatsapp-receipt.module";
import { PublicBookingsController } from "./public-bookings.controller";

@Module({
  imports: [BookingsModule, WhatsappReceiptModule],
  controllers: [PublicBookingsController],
})
export class PublicBookingsModule {}
