import { Module } from "@nestjs/common";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";

@Module({
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
