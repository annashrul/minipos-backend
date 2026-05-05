import { Module } from "@nestjs/common";
import { BookingsModule } from "../bookings/bookings.module";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";
import { PublicBookingsController } from "./public-bookings.controller";

@Module({
  imports: [BookingsModule, WhatsappReceiptModule],
  controllers: [PublicBookingsController],
})
export class PublicBookingsModule {}
