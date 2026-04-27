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
import {
  CreateSubscriptionSchema,
  ListSubscriptionsQuerySchema,
  MarkSubscriptionPaidSchema,
  type AuthUser,
  type CreateSubscriptionDto,
  type ListSubscriptionsQueryDto,
  type MarkSubscriptionPaidDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { SubscriptionsService } from "./subscriptions.service";

@Controller("subscriptions")
@UseGuards(AccessGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequireAccess("subscriptions", "view")
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
  async current(@CurrentCompany() companyId: string) {
    const data = await this.subscriptions.getCurrent(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("subscriptions", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("subscriptions", "create")
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
  async cancel(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.cancel(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("subscriptions", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.subscriptions.delete(companyId, user, id);
    return { data };
  }
}
