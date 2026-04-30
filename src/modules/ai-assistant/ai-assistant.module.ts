import { Module } from "@nestjs/common";
import { CashierModule } from "../cashier/cashier.module";
import { PurchasesModule } from "../purchases/purchases.module";
import { AiAssistantController } from "./ai-assistant.controller";
import { AiAssistantService } from "./ai-assistant.service";
import { AiChatService } from "./internal/ai-chat.service";
import { AiToolExecutor } from "./internal/ai-tool-executor.service";

@Module({
  imports: [CashierModule, PurchasesModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiChatService, AiToolExecutor],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
