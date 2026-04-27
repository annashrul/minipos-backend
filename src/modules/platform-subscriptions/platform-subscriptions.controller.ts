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
  CreatePlatformSubscriptionSchema,
  ListPlatformCompaniesQuerySchema,
  ListPlatformSubscriptionsQuerySchema,
  MarkPlatformSubscriptionPaidSchema,
  type AuthUser,
  type CreatePlatformSubscriptionDto,
  type ListPlatformCompaniesQueryDto,
  type ListPlatformSubscriptionsQueryDto,
  type MarkPlatformSubscriptionPaidDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { PlatformOwnerGuard } from "./platform-owner.guard";
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";

@Controller("platform")
@UseGuards(PlatformOwnerGuard)
export class PlatformSubscriptionsController {
  constructor(
    private readonly platformSubs: PlatformSubscriptionsService,
  ) {}

  @Get("subscriptions/stats")
  async stats() {
    const data = await this.platformSubs.stats();
    return { data };
  }

  @Get("companies")
  async listCompanies(
    @Query(new ZodValidationPipe(ListPlatformCompaniesQuerySchema))
    query: ListPlatformCompaniesQueryDto,
  ) {
    const data = await this.platformSubs.listCompanies(query);
    return { data };
  }

  @Get("subscriptions")
  async list(
    @Query(new ZodValidationPipe(ListPlatformSubscriptionsQuerySchema))
    query: ListPlatformSubscriptionsQueryDto,
  ) {
    const data = await this.platformSubs.list(query);
    return { data };
  }

  @Get("subscriptions/:id")
  async findOne(@Param("id") id: string) {
    const data = await this.platformSubs.findById(id);
    return { data };
  }

  @Post("subscriptions")
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePlatformSubscriptionSchema))
    body: CreatePlatformSubscriptionDto,
  ) {
    const data = await this.platformSubs.create(user, body);
    return { data };
  }

  @Post("subscriptions/:id/mark-paid")
  async markPaid(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MarkPlatformSubscriptionPaidSchema))
    body: MarkPlatformSubscriptionPaidDto,
  ) {
    const data = await this.platformSubs.markPaid(user, id, body);
    return { data };
  }

  @Post("subscriptions/:id/cancel")
  async cancel(@Param("id") id: string) {
    const data = await this.platformSubs.cancel(id);
    return { data };
  }

  @Delete("subscriptions/:id")
  async delete(@Param("id") id: string) {
    const data = await this.platformSubs.delete(id);
    return { data };
  }

  @Post("companies/:companyId/revoke")
  async revokeCompanyPlan(
    @CurrentUser() user: AuthUser,
    @Param("companyId") companyId: string,
  ) {
    const data = await this.platformSubs.revokeCompanyPlan(user, companyId);
    return { data };
  }
}
