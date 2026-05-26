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
import {
  CreateAccountingPeriodSchema,
  ListAccountingPeriodsQuerySchema,
  UpdateAccountingPeriodSchema,
  type CreateAccountingPeriodDto,
  type ListAccountingPeriodsQueryDto,
  type UpdateAccountingPeriodDto,
} from "./dto/accounting-periods.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { AccountingPeriodsService } from "./accounting-periods.service";

@Controller("accounting-periods")
@UseGuards(AccessGuard)
export class AccountingPeriodsController {
  constructor(private readonly periods: AccountingPeriodsService) {}

  @Get()
  @RequireAccess("accounting-periods", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListAccountingPeriodsQuerySchema))
    query: ListAccountingPeriodsQueryDto,
  ) {
    const data = await this.periods.list(companyId, query);
    return { data };
  }

  @Get("current")
  @RequireAccess("accounting-periods", "view")
  async current(@CurrentCompany() companyId: string) {
    const data = await this.periods.findCurrent(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting-periods", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.periods.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting-periods", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateAccountingPeriodSchema))
    body: CreateAccountingPeriodDto,
  ) {
    const data = await this.periods.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("accounting-periods", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateAccountingPeriodSchema))
    body: UpdateAccountingPeriodDto,
  ) {
    const data = await this.periods.update(companyId, id, body);
    return { data };
  }

  @Post(":id/close")
  @RequireAccess("accounting-periods", "close")
  async close(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.periods.close(companyId, id, user.id);
    return { data };
  }

  @Post(":id/reopen")
  @RequireAccess("accounting-periods", "reopen")
  async reopen(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.periods.reopen(companyId, id);
    return { data };
  }

  @Post(":id/lock")
  @RequireAccess("accounting-periods", "lock")
  async lock(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.periods.lock(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("accounting-periods", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.periods.delete(companyId, id);
    return { data };
  }
}
