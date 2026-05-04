import { Module } from "@nestjs/common";
import { ServiceOrdersController } from "./service-orders.controller";
import { ServiceOrdersService } from "./service-orders.service";
import { ServiceOrderReminderService } from "./service-order-reminder.service";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";

@Module({
  imports: [WhatsappReceiptModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersService, ServiceOrderReminderService],
  exports: [ServiceOrdersService, ServiceOrderReminderService],
})
export class ServiceOrdersModule {}
