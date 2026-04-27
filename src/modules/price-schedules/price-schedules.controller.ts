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
  CreatePriceScheduleSchema,
  ListPriceSchedulesQuerySchema,
  UpdatePriceScheduleSchema,
  type AuthUser,
  type CreatePriceScheduleDto,
  type ListPriceSchedulesQueryDto,
  type UpdatePriceScheduleDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { PriceSchedulesService } from "./price-schedules.service";

@Controller("price-schedules")
@UseGuards(AccessGuard)
export class PriceSchedulesController {
  constructor(private readonly schedules: PriceSchedulesService) {}

  @Get()
  @RequireAccess("price-schedules", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPriceSchedulesQuerySchema))
    query: ListPriceSchedulesQueryDto,
  ) {
    const data = await this.schedules.list(companyId, query);
    return { data };
  }

  @Get("upcoming")
  @RequireAccess("price-schedules", "view")
  async upcoming(@CurrentCompany() companyId: string) {
    const data = await this.schedules.upcoming(companyId);
    return { data };
  }

  // Cron-like batch: terapkan jadwal yang sudah due + revert yang expired.
  @Post("apply-due")
  @RequireAccess("price-schedules", "update")
  async applyDue(@CurrentCompany() companyId: string) {
    const data = await this.schedules.applyDue(companyId);
    return { data };
  }

  // Cron-like batch: revert harga yang sudah expired saja.
  @Post("revert-expired")
  @RequireAccess("price-schedules", "update")
  async revertExpired(@CurrentCompany() companyId: string) {
    const data = await this.schedules.revertExpired(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("price-schedules", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.schedules.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("price-schedules", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePriceScheduleSchema))
    body: CreatePriceScheduleDto,
  ) {
    const data = await this.schedules.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("price-schedules", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePriceScheduleSchema))
    body: UpdatePriceScheduleDto,
  ) {
    const data = await this.schedules.update(companyId, id, body);
    return { data };
  }

  @Post(":id/apply")
  @RequireAccess("price-schedules", "apply")
  async apply(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.schedules.apply(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("price-schedules", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.schedules.delete(companyId, id);
    return { data };
  }
}
