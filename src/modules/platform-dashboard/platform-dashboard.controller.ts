import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { PlatformOwnerGuard } from "@/modules/platform-subscriptions/platform-owner.guard";
import { PlatformDashboardService } from "./platform-dashboard.service";

@ApiTags("Platform Dashboard")
@ApiBearerAuth()
@Controller("platform/dashboard")
@UseGuards(PlatformOwnerGuard)
export class PlatformDashboardController {
  constructor(
    private readonly platformDashboard: PlatformDashboardService,
  ) {}

  @Get("stats")
  @ApiOperation({ summary: "Platform dashboard stats" })
  async stats() {
    const data = await this.platformDashboard.stats();
    return { data };
  }
}
