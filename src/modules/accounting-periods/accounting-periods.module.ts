import { Module } from "@nestjs/common";
import { AccountingPeriodsController } from "./accounting-periods.controller";
import { AccountingPeriodsRepository } from "./accounting-periods.repository";
import { AccountingPeriodsService } from "./accounting-periods.service";

@Module({
  controllers: [AccountingPeriodsController],
  providers: [AccountingPeriodsService, AccountingPeriodsRepository],
  exports: [AccountingPeriodsService],
})
export class AccountingPeriodsModule {}
