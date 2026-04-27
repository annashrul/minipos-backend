import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateInstallmentPlanSchema,
  PayInstallmentSchema,
  PreviewInstallmentScheduleSchema,
  UpcomingInstallmentsQuerySchema,
  type AuthUser,
  type CreateInstallmentPlanDto,
  type PayInstallmentDto,
  type PreviewInstallmentScheduleDto,
  type UpcomingInstallmentsQueryDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { InstallmentsService } from "./installments.service";

@Controller("installments")
@UseGuards(AccessGuard)
export class InstallmentsController {
  constructor(private readonly service: InstallmentsService) {}

  @Get("upcoming")
  @RequireAccess("debts", "view")
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
  async byDebt(
    @CurrentCompany() companyId: string,
    @Param("debtId") debtId: string,
  ) {
    const data = await this.service.getByDebt(companyId, debtId);
    return { data };
  }

  @Post("plan")
  @RequireAccess("debts", "update")
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
  async preview(
    @Body(new ZodValidationPipe(PreviewInstallmentScheduleSchema))
    body: PreviewInstallmentScheduleDto,
  ) {
    const data = this.service.previewSchedule(body);
    return { data };
  }

  @Post(":id/pay")
  @RequireAccess("debts", "update")
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
  async updateOverdue(@CurrentCompany() companyId: string) {
    const data = await this.service.updateOverdue(companyId);
    return { data };
  }
}
