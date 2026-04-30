import { Module } from "@nestjs/common";
import { AccountingReportsController } from "./accounting-reports.controller";
import { AccountingReportsService } from "./accounting-reports.service";
import { FinancialStatementService } from "./internal/financial-statement.service";
import { LedgerService } from "./internal/ledger.service";
import { PeriodClosingService } from "./internal/period-closing.service";
import { TaxComplianceService } from "./internal/tax-compliance.service";

@Module({
  controllers: [AccountingReportsController],
  providers: [
    AccountingReportsService,
    LedgerService,
    FinancialStatementService,
    TaxComplianceService,
    PeriodClosingService,
  ],
  exports: [AccountingReportsService],
})
export class AccountingReportsModule {}
