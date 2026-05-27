import { Module } from "@nestjs/common";
import { CashierModule } from "@/modules/cashier/cashier.module";
import { PurchasesModule } from "@/modules/purchases/purchases.module";
import { AiAssistantController } from "./ai-assistant.controller";
import { AiAssistantService } from "./ai-assistant.service";
import { AiAssistantRepository } from "./ai-assistant.repository";
import { AiAssistantToolsService } from "./ai-assistant-tools.service";

@Module({
  imports: [CashierModule, PurchasesModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantRepository, AiAssistantService, AiAssistantToolsService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
