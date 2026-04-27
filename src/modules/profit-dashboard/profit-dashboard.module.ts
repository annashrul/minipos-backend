import { Module } from "@nestjs/common";
import { ProfitDashboardController } from "./profit-dashboard.controller";
import { ProfitDashboardService } from "./profit-dashboard.service";

@Module({
  controllers: [ProfitDashboardController],
  providers: [ProfitDashboardService],
  exports: [ProfitDashboardService],
})
export class ProfitDashboardModule {}
