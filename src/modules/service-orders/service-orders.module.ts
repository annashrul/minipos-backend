import { Module } from "@nestjs/common";
import { ServiceOrdersController } from "./service-orders.controller";
import { ServiceOrdersRepository } from "./service-orders.repository";
import { ServiceOrdersService } from "./service-orders.service";
import { ServiceOrderReminderService } from "./service-order-reminder.service";
import { WhatsappReceiptModule } from "@/modules/whatsapp-receipt/whatsapp-receipt.module";

@Module({
  imports: [WhatsappReceiptModule],
  controllers: [ServiceOrdersController],
  providers: [ServiceOrdersRepository, ServiceOrdersService, ServiceOrderReminderService],
  exports: [ServiceOrdersService, ServiceOrderReminderService],
})
export class ServiceOrdersModule {}
