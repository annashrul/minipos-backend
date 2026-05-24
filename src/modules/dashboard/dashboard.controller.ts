import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  DashboardExtendedStatsQuerySchema,
  DashboardListQuerySchema,
  DashboardStatsQuerySchema,
  type DashboardExtendedStatsQueryDto,
  type DashboardListQueryDto,
  type DashboardStatsQueryDto,
} from "./dto/dashboard.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(AccessGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("stats")
  @RequireAccess("dashboard", "view")
  async stats(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(DashboardStatsQuerySchema))
    query: DashboardStatsQueryDto,
  ) {
    const data = await this.dashboard.stats(companyId, query);
    return { data };
  }

  @Get("extended-stats")
  @RequireAccess("dashboard", "view")
  async extendedStats(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(DashboardExtendedStatsQuerySchema))
    query: DashboardExtendedStatsQueryDto,
  ) {
    const data = await this.dashboard.extendedStats(companyId, query);
    return { data };
  }

  @Get("low-stock")
  @RequireAccess("dashboard", "view")
  async lowStock(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(DashboardListQuerySchema))
    query: DashboardListQueryDto,
  ) {
    const data = await this.dashboard.lowStock(companyId, query);
    return { data };
  }

  @Get("expiring")
  @RequireAccess("dashboard", "view")
  async expiring(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(DashboardListQuerySchema))
    query: DashboardListQueryDto,
  ) {
    const data = await this.dashboard.expiring(companyId, query);
    return { data };
  }

  @Get("alerts")
  @RequireAccess("dashboard", "view")
  async alerts(@CurrentCompany() companyId: string) {
    const data = await this.dashboard.alerts(companyId);
    return { data };
  }
}
