import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  CashierPerformanceLeaderboardQuerySchema,
  CashierPerformanceQuerySchema,
  type CashierPerformanceLeaderboardQueryDto,
  type CashierPerformanceQueryDto,
} from "./dto/cashier.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { CashierService } from "./cashier.service";

@Controller("cashier/performance")
@UseGuards(AccessGuard)
export class CashierPerformanceController {
  constructor(private readonly cashier: CashierService) {}

  @Get()
  @RequireAccess("cashier-performance", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(CashierPerformanceQuerySchema))
    query: CashierPerformanceQueryDto,
  ) {
    const data = await this.cashier.getPerformance(companyId, query);
    return { data };
  }

  @Get("leaderboard")
  @RequireAccess("cashier-performance", "view")
  async leaderboard(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(CashierPerformanceLeaderboardQuerySchema))
    query: CashierPerformanceLeaderboardQueryDto,
  ) {
    const data = await this.cashier.getLeaderboard(companyId, query);
    return { data };
  }

  @Get("me")
  async me(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.cashier.getMyPerformance(companyId, user.id);
    return { data };
  }
}
