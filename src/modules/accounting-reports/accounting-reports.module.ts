import { Module } from "@nestjs/common";
import { AccountingReportsController } from "./accounting-reports.controller";
import { AccountingReportsRepository } from "./accounting-reports.repository";
import { AccountingReportsService } from "./accounting-reports.service";
import { IncomeBalanceSheetService } from "./income-balance-sheet.service";
import { TaxAgingService } from "./tax-aging.service";

@Module({
  controllers: [AccountingReportsController],
  providers: [
    AccountingReportsRepository,
    AccountingReportsService,
    IncomeBalanceSheetService,
    TaxAgingService,
  ],
  exports: [AccountingReportsService],
})
export class AccountingReportsModule {}
