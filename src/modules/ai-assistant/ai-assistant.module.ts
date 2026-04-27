import { Module } from "@nestjs/common";
import { CashierModule } from "../cashier/cashier.module";
import { PurchasesModule } from "../purchases/purchases.module";
import { AiAssistantController } from "./ai-assistant.controller";
import { AiAssistantService } from "./ai-assistant.service";

@Module({
  imports: [CashierModule, PurchasesModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
