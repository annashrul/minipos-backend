import { Module } from "@nestjs/common";
import { BankReconciliationController } from "./bank-reconciliation.controller";
import { BankReconciliationService } from "./bank-reconciliation.service";
import { BankReconciliationRepository } from "./bank-reconciliation.repository";

@Module({
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService, BankReconciliationRepository],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
