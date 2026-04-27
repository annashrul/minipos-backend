import { Module } from "@nestjs/common";
import { AccountingReportsController } from "./accounting-reports.controller";
import { AccountingReportsService } from "./accounting-reports.service";

@Module({
  controllers: [AccountingReportsController],
  providers: [AccountingReportsService],
  exports: [AccountingReportsService],
})
export class AccountingReportsModule {}
