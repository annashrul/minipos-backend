import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { DashboardExtendedService } from "./internal/dashboard-extended.service";
import { DashboardRawQueries } from "./internal/dashboard-raw-queries";
import { DashboardStatsService } from "./internal/dashboard-stats.service";
import { DashboardStockService } from "./internal/dashboard-stock.service";

@Module({
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DashboardStatsService,
    DashboardExtendedService,
    DashboardStockService,
    DashboardRawQueries,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
