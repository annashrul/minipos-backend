import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  MarginDistributionQuerySchema,
  ProfitByBranchQuerySchema,
  ProfitByCategoryQuerySchema,
  ProfitByProductQuerySchema,
  ProfitOverviewQuerySchema,
  ProfitTrendQuerySchema,
  type MarginDistributionQueryDto,
  type ProfitByBranchQueryDto,
  type ProfitByCategoryQueryDto,
  type ProfitByProductQueryDto,
  type ProfitOverviewQueryDto,
  type ProfitTrendQueryDto,
} from "./dto/profit-dashboard.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompanyOrNull } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProfitDashboardService } from "./profit-dashboard.service";

@Controller("profit-dashboard")
@UseGuards(AccessGuard)
export class ProfitDashboardController {
  constructor(private readonly service: ProfitDashboardService) {}

  @Get("overview")
  @RequireAccess("profit-dashboard", "view")
  async overview(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(ProfitOverviewQuerySchema))
    query: ProfitOverviewQueryDto,
  ) {
    const data = await this.service.getOverview(
      companyId,
      query.period,
      query.branchId,
    );
    return { data };
  }

  @Get("by-category")
  @RequireAccess("profit-dashboard", "view")
  async byCategory(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(ProfitByCategoryQuerySchema))
    query: ProfitByCategoryQueryDto,
  ) {
    const data = await this.service.getByCategory(
      companyId,
      query.period,
      query.branchId,
    );
    return { data };
  }

  @Get("by-product")
  @RequireAccess("profit-dashboard", "view")
  async byProduct(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(ProfitByProductQuerySchema))
    query: ProfitByProductQueryDto,
  ) {
    const data = await this.service.getByProduct(
      companyId,
      query.period,
      query.branchId,
      query.limit,
      query.order,
    );
    return { data };
  }

  @Get("by-branch")
  @RequireAccess("profit-dashboard", "view")
  async byBranch(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(ProfitByBranchQuerySchema))
    query: ProfitByBranchQueryDto,
  ) {
    const data = await this.service.getByBranch(companyId, query.period);
    return { data };
  }

  @Get("trend")
  @RequireAccess("profit-dashboard", "view")
  async trend(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(ProfitTrendQuerySchema))
    query: ProfitTrendQueryDto,
  ) {
    const data = await this.service.getTrend(
      companyId,
      query.days,
      query.branchId,
    );
    return { data };
  }

  @Get("margin-distribution")
  @RequireAccess("profit-dashboard", "view")
  async marginDistribution(
    @CurrentCompanyOrNull() companyId: string | null,
    @Query(new ZodValidationPipe(MarginDistributionQuerySchema))
    query: MarginDistributionQueryDto,
  ) {
    const data = await this.service.getMarginDistribution(
      companyId,
      query.branchId,
    );
    return { data };
  }
}
