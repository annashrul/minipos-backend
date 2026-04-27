import { Controller, Get, UseGuards } from "@nestjs/common";
import { PlatformOwnerGuard } from "../platform-subscriptions/platform-owner.guard";
import { PlatformDashboardService } from "./platform-dashboard.service";

@Controller("platform/dashboard")
@UseGuards(PlatformOwnerGuard)
export class PlatformDashboardController {
  constructor(
    private readonly platformDashboard: PlatformDashboardService,
  ) {}

  @Get("stats")
  async stats() {
    const data = await this.platformDashboard.stats();
    return { data };
  }
}
