import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repository";
import { DashboardService } from "./dashboard.service";

@Module({
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
