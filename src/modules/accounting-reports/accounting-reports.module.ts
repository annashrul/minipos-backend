import { Module } from "@nestjs/common";
import { AccountingReportsController } from "./accounting-reports.controller";
import { AccountingReportsRepository } from "./accounting-reports.repository";
import { AccountingReportsService } from "./accounting-reports.service";

@Module({
  controllers: [AccountingReportsController],
  providers: [AccountingReportsRepository, AccountingReportsService],
  exports: [AccountingReportsService],
})
export class AccountingReportsModule {}
