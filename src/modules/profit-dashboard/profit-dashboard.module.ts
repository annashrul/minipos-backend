import { Module } from "@nestjs/common";
import { ProfitDashboardController } from "./profit-dashboard.controller";
import { ProfitDashboardRepository } from "./profit-dashboard.repository";
import { ProfitDashboardService } from "./profit-dashboard.service";

@Module({
  controllers: [ProfitDashboardController],
  providers: [ProfitDashboardRepository, ProfitDashboardService],
  exports: [ProfitDashboardService],
})
export class ProfitDashboardModule {}
