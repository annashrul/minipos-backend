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
import { type AuthUser } from "@/contracts";
import {
  CreateSubscriptionSchema,
  ListSubscriptionsQuerySchema,
  MarkSubscriptionPaidSchema,
  type CreateSubscriptionDto,
  type ListSubscriptionsQueryDto,
  type MarkSubscriptionPaidDto,
} from "./dto/subscriptions.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { SubscriptionsService } from "./subscriptions.service";

@ApiTags("Subscriptions")
@ApiBearerAuth()
@Controller("subscriptions")
@UseGuards(AccessGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequireAccess("subscriptions", "view")
  @ApiOperation({ summary: "List subscriptions" })
  @ApiZodQuery(ListSubscriptionsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListSubscriptionsQuerySchema))
    query: ListSubscriptionsQueryDto,
  ) {
    const data = await this.subscriptions.list(companyId, query);
    return { data };
  }

  @Get("current")
  @RequireAccess("subscriptions", "view")
  @ApiOperation({ summary: "Get current subscription" })
  async current(@CurrentCompany() companyId: string) {
    const data = await this.subscriptions.getCurrent(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("subscriptions", "view")
  @ApiOperation({ summary: "Get subscription by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("subscriptions", "create")
  @ApiOperation({ summary: "Create subscription" })
  @ApiZodBody(CreateSubscriptionSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateSubscriptionSchema))
    body: CreateSubscriptionDto,
  ) {
    const data = await this.subscriptions.create(companyId, body);
    return { data };
  }

  @Post(":id/mark-paid")
  @RequireAccess("subscriptions", "update")
  @ApiOperation({ summary: "Mark subscription as paid" })
  @ApiZodBody(MarkSubscriptionPaidSchema)
  async markPaid(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MarkSubscriptionPaidSchema))
    body: MarkSubscriptionPaidDto,
  ) {
    const data = await this.subscriptions.markPaid(companyId, user, id, body);
    return { data };
  }

  @Post(":id/cancel")
  @RequireAccess("subscriptions", "update")
  @ApiOperation({ summary: "Cancel subscription" })
  async cancel(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.cancel(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("subscriptions", "delete")
  @ApiOperation({ summary: "Delete subscription" })
  async delete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.delete(companyId, user, id);
    return { data };
  }
}
