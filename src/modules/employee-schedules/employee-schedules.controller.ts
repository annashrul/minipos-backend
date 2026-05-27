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
  BulkCreateEmployeeSchedulesSchema,
  CreateEmployeeScheduleSchema,
  ListEmployeeSchedulesQuerySchema,
  UpdateEmployeeScheduleSchema,
  UpdateScheduleStatusSchema,
  type BulkCreateEmployeeSchedulesDto,
  type CreateEmployeeScheduleDto,
  type ListEmployeeSchedulesQueryDto,
  type UpdateEmployeeScheduleDto,
  type UpdateScheduleStatusDto,
} from "./dto/employee-schedules.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { EmployeeSchedulesService } from "./employee-schedules.service";

@Controller("employee-schedules")
@UseGuards(AccessGuard)
export class EmployeeSchedulesController {
  constructor(private readonly schedules: EmployeeSchedulesService) {}

  @Get()
  @RequireAccess("employee-schedules", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListEmployeeSchedulesQuerySchema))
    query: ListEmployeeSchedulesQueryDto,
  ) {
    const data = await this.schedules.list(companyId, query);
    return { data };
  }

  @Get("by-date/:date")
  @RequireAccess("employee-schedules", "view")
  async byDate(
    @CurrentCompany() companyId: string,
    @Param("date") date: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.schedules.byDate(companyId, date, branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("employee-schedules", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.schedules.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("employee-schedules", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateEmployeeScheduleSchema))
    body: CreateEmployeeScheduleDto,
  ) {
    const data = await this.schedules.create(companyId, user.id, body);
    return { data };
  }

  @Post("bulk")
  @RequireAccess("employee-schedules", "create")
  async bulk(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(BulkCreateEmployeeSchedulesSchema))
    body: BulkCreateEmployeeSchedulesDto,
  ) {
    const data = await this.schedules.bulkCreate(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("employee-schedules", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateEmployeeScheduleSchema))
    body: UpdateEmployeeScheduleDto,
  ) {
    const data = await this.schedules.update(companyId, id, body);
    return { data };
  }

  @Patch(":id/status")
  @RequireAccess("employee-schedules", "update")
  async updateStatus(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateScheduleStatusSchema))
    body: UpdateScheduleStatusDto,
  ) {
    const data = await this.schedules.updateStatus(companyId, id, body.status);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("employee-schedules", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.schedules.delete(companyId, id);
    return { data };
  }
}
