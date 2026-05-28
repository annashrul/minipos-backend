import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  AutoAwardBadgesSchema,
  CreateCashierBadgeSchema,
  ListCashierBadgesQuerySchema,
  type AutoAwardBadgesDto,
  type CreateCashierBadgeDto,
  type ListCashierBadgesQueryDto,
} from "./dto/cashier.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { CashierService } from "./cashier.service";

@ApiTags("Cashier Badges")
@ApiBearerAuth()
@Controller("cashier/badges")
@UseGuards(AccessGuard)
export class CashierBadgesController {
  constructor(private readonly cashier: CashierService) {}

  @Get()
  @RequireAccess("cashier-badges", "view")
  @ApiOperation({ summary: "List cashier badges" })
  @ApiZodQuery(ListCashierBadgesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCashierBadgesQuerySchema))
    query: ListCashierBadgesQueryDto,
  ) {
    const targetUserId = query.userId ?? user.id;
    const data = await this.cashier.listBadges(companyId, targetUserId);
    return { data };
  }

  @Post()
  @RequireAccess("cashier-badges", "create")
  @ApiOperation({ summary: "Create cashier badge" })
  @ApiZodBody(CreateCashierBadgeSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateCashierBadgeSchema))
    body: CreateCashierBadgeDto,
  ) {
    const data = await this.cashier.createBadge(companyId, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("cashier-badges", "delete")
  @ApiOperation({ summary: "Delete cashier badge" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.cashier.deleteBadge(companyId, id);
    return { data };
  }

  @Post("auto-award")
  @RequireAccess("cashier-badges", "award")
  @ApiOperation({ summary: "Auto-award eligible badges" })
  @ApiZodBody(AutoAwardBadgesSchema)
  async autoAward(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(AutoAwardBadgesSchema))
    body: AutoAwardBadgesDto,
  ) {
    const data = await this.cashier.autoAwardBadges(companyId, body.userId);
    return { data };
  }
}
