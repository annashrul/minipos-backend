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
import {
  CreateServiceOrderSchema,
  FinalizeServiceOrderSchema,
  ListServiceOrdersQuerySchema,
  TransitionStatusSchema,
  UpdateServiceOrderSchema,
  type CreateServiceOrderDto,
  type FinalizeServiceOrderDto,
  type ListServiceOrdersQueryDto,
  type TransitionStatusDto,
  type UpdateServiceOrderDto,
} from "./dto/service-order.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { Public } from "@/modules/auth/public.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ServiceOrdersService } from "./service-orders.service";
import { ServiceOrderReminderService } from "./service-order-reminder.service";

@ApiTags("Service Orders")
@ApiBearerAuth()
@Controller("service-orders")
@UseGuards(AccessGuard)
export class ServiceOrdersController {
  constructor(
    private readonly svc: ServiceOrdersService,
    private readonly reminder: ServiceOrderReminderService,
  ) {}

  // Trigger reminder cron secara manual — dipakai admin untuk testing /
  // burst-send tanpa menunggu jadwal cron jam 09:00.
  @Post("reminders/run")
  @RequireAccess("service-orders", "update")
  @ApiOperation({ summary: "Trigger service order reminders" })
  async runReminders() {
    const result = await this.reminder.triggerNow();
    return { data: result };
  }

  @Get()
  @RequireAccess("service-orders", "view")
  @ApiOperation({ summary: "List service orders" })
  @ApiZodQuery(ListServiceOrdersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListServiceOrdersQuerySchema))
    query: ListServiceOrdersQueryDto,
  ) {
    const data = await this.svc.list(companyId, query);
    return { data };
  }

  // Public endpoint untuk antrian display di TV ruang tunggu bengkel.
  // No auth — pakai companyId + branchId dari URL. Data dibatasi: hanya field
  // yang relevan untuk display (no email customer, no estimateAmount, dll).
  @Get("queue/public/:companyId/:branchId")
  @Public()
  @ApiOperation({ summary: "Public service order queue" })
  async publicQueue(
    @Param("companyId") companyId: string,
    @Param("branchId") branchId: string,
  ) {
    const data = await this.svc.publicQueue(companyId, branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("service-orders", "view")
  @ApiOperation({ summary: "Get service order by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.svc.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("service-orders", "create")
  @ApiOperation({ summary: "Create service order" })
  @ApiZodBody(CreateServiceOrderSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateServiceOrderSchema))
    body: CreateServiceOrderDto,
  ) {
    const data = await this.svc.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("service-orders", "update")
  @ApiOperation({ summary: "Update service order" })
  @ApiZodBody(UpdateServiceOrderSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateServiceOrderSchema))
    body: UpdateServiceOrderDto,
  ) {
    const data = await this.svc.update(companyId, id, body);
    return { data };
  }

  @Post(":id/transition")
  @RequireAccess("service-orders", "update")
  @ApiOperation({ summary: "Transition service order status" })
  @ApiZodBody(TransitionStatusSchema)
  async transition(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(TransitionStatusSchema))
    body: TransitionStatusDto,
  ) {
    const data = await this.svc.transitionStatus(companyId, id, body);
    return { data };
  }

  @Post(":id/finalize")
  @RequireAccess("service-orders", "finalize")
  @ApiOperation({ summary: "Finalize service order" })
  @ApiZodBody(FinalizeServiceOrderSchema)
  async finalize(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(FinalizeServiceOrderSchema))
    body: FinalizeServiceOrderDto,
  ) {
    const data = await this.svc.finalize(companyId, user.id, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("service-orders", "delete")
  @ApiOperation({ summary: "Delete service order" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.svc.delete(companyId, id);
    return { data };
  }
}
