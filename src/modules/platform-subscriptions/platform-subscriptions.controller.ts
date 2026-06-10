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
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { type AuthUser } from "@/contracts";
import {
  CreatePlatformSubscriptionSchema,
  ListPlatformCompaniesQuerySchema,
  ListPlatformSubscriptionsQuerySchema,
  MarkPlatformSubscriptionPaidSchema,
  UpdatePlatformCompanySchema,
  type CreatePlatformSubscriptionDto,
  type ListPlatformCompaniesQueryDto,
  type ListPlatformSubscriptionsQueryDto,
  type MarkPlatformSubscriptionPaidDto,
  type UpdatePlatformCompanyDto,
} from "./dto/platform-subscriptions.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import {
  RegisterCompanySchema,
  type RegisterCompanyDto,
} from "@/modules/register/dto/register.dto";
import { RegisterService } from "@/modules/register/register.service";
import { PlatformOwnerGuard } from "./platform-owner.guard";
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";

@ApiTags("Platform")
@ApiBearerAuth()
@Controller("platform")
@UseGuards(PlatformOwnerGuard)
export class PlatformSubscriptionsController {
  constructor(
    private readonly platformSubs: PlatformSubscriptionsService,
    private readonly register: RegisterService,
  ) {}

  // Buat tenant baru oleh PLATFORM OWNER — LANGSUNG AKTIF (admin phoneVerified,
  // tanpa OTP). Berbeda dari /register/company (self-register publik yang
  // butuh verifikasi OTP WhatsApp).
  @Post("companies")
  @ApiOperation({ summary: "Create tenant (active immediately)" })
  @ApiZodBody(RegisterCompanySchema)
  async createCompany(
    @Body(new ZodValidationPipe(RegisterCompanySchema))
    body: RegisterCompanyDto,
  ) {
    const data = await this.register.registerCompany(body, {
      autoActivate: true,
    });
    return { data };
  }

  // Update info tenant + toggle aktif/nonaktif (soft).
  @Patch("companies/:id")
  @ApiOperation({ summary: "Update tenant (info / active)" })
  @ApiZodBody(UpdatePlatformCompanySchema)
  async updateCompany(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePlatformCompanySchema))
    body: UpdatePlatformCompanyDto,
  ) {
    const data = await this.platformSubs.updateCompany(id, body);
    return { data };
  }

  // HARD DELETE tenant (permanen — hapus seluruh data).
  @Delete("companies/:id")
  @ApiOperation({ summary: "Hard-delete tenant (permanent)" })
  async deleteCompany(@Param("id") id: string) {
    const data = await this.platformSubs.hardDeleteCompany(id);
    return { data };
  }

  @Get("subscriptions/stats")
  @ApiOperation({ summary: "Platform subscriptions stats" })
  async stats() {
    const data = await this.platformSubs.stats();
    return { data };
  }

  @Get("companies")
  @ApiOperation({ summary: "List platform companies" })
  @ApiZodQuery(ListPlatformCompaniesQuerySchema)
  async listCompanies(
    @Query(new ZodValidationPipe(ListPlatformCompaniesQuerySchema))
    query: ListPlatformCompaniesQueryDto,
  ) {
    const data = await this.platformSubs.listCompanies(query);
    return { data };
  }

  @Get("subscriptions")
  @ApiOperation({ summary: "List platform subscriptions" })
  @ApiZodQuery(ListPlatformSubscriptionsQuerySchema)
  async list(
    @Query(new ZodValidationPipe(ListPlatformSubscriptionsQuerySchema))
    query: ListPlatformSubscriptionsQueryDto,
  ) {
    const data = await this.platformSubs.list(query);
    return { data };
  }

  @Get("subscriptions/:id")
  @ApiOperation({ summary: "Get platform subscription by ID" })
  async findOne(@Param("id") id: string) {
    const data = await this.platformSubs.findById(id);
    return { data };
  }

  @Post("subscriptions")
  @ApiOperation({ summary: "Create platform subscription" })
  @ApiZodBody(CreatePlatformSubscriptionSchema)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePlatformSubscriptionSchema))
    body: CreatePlatformSubscriptionDto,
  ) {
    const data = await this.platformSubs.create(user, body);
    return { data };
  }

  @Post("subscriptions/:id/mark-paid")
  @ApiOperation({ summary: "Mark platform subscription as paid" })
  @ApiZodBody(MarkPlatformSubscriptionPaidSchema)
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
  @ApiOperation({ summary: "Cancel platform subscription" })
  async cancel(@Param("id") id: string) {
    const data = await this.platformSubs.cancel(id);
    return { data };
  }

  @Delete("subscriptions/:id")
  @ApiOperation({ summary: "Delete platform subscription" })
  async delete(@Param("id") id: string) {
    const data = await this.platformSubs.delete(id);
    return { data };
  }

  @Post("companies/:companyId/revoke")
  @ApiOperation({ summary: "Revoke company subscription plan" })
  async revokeCompanyPlan(
    @CurrentUser() user: AuthUser,
    @Param("companyId") companyId: string,
  ) {
    const data = await this.platformSubs.revokeCompanyPlan(user, companyId);
    return { data };
  }
}
