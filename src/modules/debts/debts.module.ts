import { Module } from "@nestjs/common";
import { DebtsController } from "./debts.controller";
import { DebtsRepository } from "./debts.repository";
import { DebtsService } from "./debts.service";

@Module({
  controllers: [DebtsController],
  providers: [DebtsRepository, DebtsService],
  exports: [DebtsService],
})
export class DebtsModule {}
