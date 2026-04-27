import { Module } from "@nestjs/common";
import { PlatformDashboardController } from "./platform-dashboard.controller";
import { PlatformDashboardService } from "./platform-dashboard.service";

@Module({
  controllers: [PlatformDashboardController],
  providers: [PlatformDashboardService],
  exports: [PlatformDashboardService],
})
export class PlatformDashboardModule {}
