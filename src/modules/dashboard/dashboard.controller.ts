import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  DashboardExtendedStatsQuerySchema,
  DashboardListQuerySchema,
  DashboardStatsQuerySchema,
  type DashboardExtendedStatsQueryDto,
  type DashboardListQueryDto,
  type DashboardStatsQueryDto,
} from "./dto/dashboard.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { DashboardService } from "./dashboard.service";

@ApiTags("Dashboard")
@ApiBearerAuth()
@Controller("dashboard")
@UseGuards(AccessGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("stats")
  @RequireAccess("dashboard", "view")
  @ApiOperation({ summary: "Dashboard stats" })
  @ApiZodQuery(DashboardStatsQuerySchema)
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
  @ApiOperation({ summary: "Dashboard extended stats" })
  @ApiZodQuery(DashboardExtendedStatsQuerySchema)
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
  @ApiOperation({ summary: "List low-stock items" })
  @ApiZodQuery(DashboardListQuerySchema)
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
  @ApiOperation({ summary: "List expiring items" })
  @ApiZodQuery(DashboardListQuerySchema)
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
  @ApiOperation({ summary: "Dashboard alerts" })
  async alerts(@CurrentCompany() companyId: string) {
    const data = await this.dashboard.alerts(companyId);
    return { data };
  }
}
