import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { type AuthUser } from "@/contracts";
import {
  CreateSalesTargetSchema,
  EvaluateBadgesSchema,
  GetSalesBadgesQuerySchema,
  LeaderboardQuerySchema,
  ListSalesTargetsQuerySchema,
  UpdateSalesTargetSchema,
  type CreateSalesTargetDto,
  type EvaluateBadgesDto,
  type GetSalesBadgesQueryDto,
  type LeaderboardQueryDto,
  type ListSalesTargetsQueryDto,
  type UpdateSalesTargetDto,
} from "./dto/sales-targets.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { SalesTargetsService } from "./sales-targets.service";

@Controller("sales-targets")
@UseGuards(AccessGuard)
export class SalesTargetsController {
  constructor(private readonly salesTargets: SalesTargetsService) {}

  @Get()
  @RequireAccess("sales-targets", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListSalesTargetsQuerySchema))
    query: ListSalesTargetsQueryDto,
  ) {
    const data = await this.salesTargets.list(companyId, query);
    return { data };
  }

  @Get("current")
  @RequireAccess("sales-targets", "view")
  async current(@CurrentCompany() companyId: string) {
    const data = await this.salesTargets.current(companyId);
    return { data };
  }

  // Ranking user berdasarkan revenue dalam periode (default MONTHLY).
  @Get("leaderboard")
  @RequireAccess("sales-targets", "view")
  async leaderboard(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(LeaderboardQuerySchema))
    query: LeaderboardQueryDto,
  ) {
    const data = await this.salesTargets.leaderboard(companyId, query);
    return { data };
  }

  // List CashierBadge (sales/manager facing â€” terpisah dari /cashier/badges).
  @Get("badges")
  @RequireAccess("sales-targets", "view")
  async listBadges(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(GetSalesBadgesQuerySchema))
    query: GetSalesBadgesQueryDto,
  ) {
    const data = await this.salesTargets.listBadges(companyId, query);
    return { data };
  }

  // Auto-evaluasi & award badges untuk periode (cron-like).
  @Post("evaluate-badges")
  @RequireAccess("sales-targets", "create")
  async evaluateBadges(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(EvaluateBadgesSchema))
    body: EvaluateBadgesDto,
  ) {
    const data = await this.salesTargets.evaluateAndAwardBadges(
      companyId,
      body,
    );
    return { data };
  }

  @Get(":id")
  @RequireAccess("sales-targets", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.salesTargets.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("sales-targets", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSalesTargetSchema))
    body: CreateSalesTargetDto,
  ) {
    const data = await this.salesTargets.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("sales-targets", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateSalesTargetSchema))
    body: UpdateSalesTargetDto,
  ) {
    const data = await this.salesTargets.update(companyId, id, body);
    return { data };
  }

  @Post(":id/recompute")
  @RequireAccess("sales-targets", "update")
  async recompute(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.salesTargets.recompute(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("sales-targets", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.salesTargets.delete(companyId, id);
    return { data };
  }
}
