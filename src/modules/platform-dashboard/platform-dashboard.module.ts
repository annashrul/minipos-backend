import { Module } from "@nestjs/common";
import { PlatformDashboardController } from "./platform-dashboard.controller";
import { PlatformDashboardRepository } from "./platform-dashboard.repository";
import { PlatformDashboardService } from "./platform-dashboard.service";

@Module({
  controllers: [PlatformDashboardController],
  providers: [PlatformDashboardService, PlatformDashboardRepository],
  exports: [PlatformDashboardService],
})
export class PlatformDashboardModule {}
