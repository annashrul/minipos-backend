import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { type AuthUser } from "@/contracts";
import {
  CreateInstallmentPlanSchema,
  PayInstallmentSchema,
  PreviewInstallmentScheduleSchema,
  UpcomingInstallmentsQuerySchema,
  type CreateInstallmentPlanDto,
  type PayInstallmentDto,
  type PreviewInstallmentScheduleDto,
  type UpcomingInstallmentsQueryDto,
} from "./dto/installments.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { InstallmentsService } from "./installments.service";

@ApiTags("Installments")
@ApiBearerAuth()
@Controller("installments")
@UseGuards(AccessGuard)
export class InstallmentsController {
  constructor(private readonly service: InstallmentsService) {}

  @Get("upcoming")
  @RequireAccess("debts", "view")
  @ApiOperation({ summary: "List upcoming installments" })
  @ApiZodQuery(UpcomingInstallmentsQuerySchema)
  async upcoming(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(UpcomingInstallmentsQuerySchema))
    query: UpcomingInstallmentsQueryDto,
  ) {
    const data = await this.service.getUpcomingDue(companyId, query.daysAhead);
    return { data };
  }

  @Get("by-debt/:debtId")
  @RequireAccess("debts", "view")
  @ApiOperation({ summary: "Get installments by debt" })
  async byDebt(
    @CurrentCompany() companyId: string,
    @Param("debtId") debtId: string,
  ) {
    const data = await this.service.getByDebt(companyId, debtId);
    return { data };
  }

  @Post("plan")
  @RequireAccess("debts", "update")
  @ApiOperation({ summary: "Create installment plan" })
  @ApiZodBody(CreateInstallmentPlanSchema)
  async createPlan(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateInstallmentPlanSchema))
    body: CreateInstallmentPlanDto,
  ) {
    const data = await this.service.createPlan(companyId, user.id, body);
    return { data };
  }

  @Post("preview")
  @RequireAccess("debts", "view")
  @ApiOperation({ summary: "Preview installment schedule" })
  @ApiZodBody(PreviewInstallmentScheduleSchema)
  async preview(
    @Body(new ZodValidationPipe(PreviewInstallmentScheduleSchema))
    body: PreviewInstallmentScheduleDto,
  ) {
    const data = this.service.previewSchedule(body);
    return { data };
  }

  @Post(":id/pay")
  @RequireAccess("debts", "update")
  @ApiOperation({ summary: "Pay installment" })
  @ApiZodBody(PayInstallmentSchema)
  async pay(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(PayInstallmentSchema))
    body: PayInstallmentDto,
  ) {
    const data = await this.service.pay(companyId, user.id, id, body);
    return { data };
  }

  @Post("update-overdue")
  @RequireAccess("debts", "update")
  @ApiOperation({ summary: "Update overdue installments" })
  async updateOverdue(@CurrentCompany() companyId: string) {
    const data = await this.service.updateOverdue(companyId);
    return { data };
  }
}
