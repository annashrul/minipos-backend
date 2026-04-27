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
  ListClosingReportsQuerySchema,
  RecloseShiftSchema,
  UpdateClosingReportSchema,
  type ListClosingReportsQueryDto,
  type RecloseShiftDto,
  type UpdateClosingReportDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ClosingReportsService } from "./closing-reports.service";

@Controller("closing-reports")
@UseGuards(AccessGuard)
export class ClosingReportsController {
  constructor(private readonly closingReports: ClosingReportsService) {}

  @Get()
  @RequireAccess("closing-reports", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListClosingReportsQuerySchema))
    query: ListClosingReportsQueryDto,
  ) {
    const data = await this.closingReports.list(companyId, query);
    return { data };
  }

  @Get("by-shift/:shiftId")
  @RequireAccess("closing-reports", "view")
  async findByShift(
    @CurrentCompany() companyId: string,
    @Param("shiftId") shiftId: string,
  ) {
    const data = await this.closingReports.findByShift(companyId, shiftId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("closing-reports", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.closingReports.findById(companyId, id);
    return { data };
  }

  @Post("from-shift/:shiftId")
  @RequireAccess("closing-reports", "create")
  async createFromShift(
    @CurrentCompany() companyId: string,
    @Param("shiftId") shiftId: string,
  ) {
    const data = await this.closingReports.createFromShift(companyId, shiftId);
    return { data };
  }

  @Post(":shiftId/reclose")
  @RequireAccess("closing-reports", "reclosing")
  async reclose(
    @CurrentCompany() companyId: string,
    @Param("shiftId") shiftId: string,
    @Body(new ZodValidationPipe(RecloseShiftSchema)) body: RecloseShiftDto,
  ) {
    const data = await this.closingReports.recloseShift(
      companyId,
      shiftId,
      body,
    );
    return { data };
  }

  @Patch(":id")
  @RequireAccess("closing-reports", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateClosingReportSchema))
    body: UpdateClosingReportDto,
  ) {
    const data = await this.closingReports.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("closing-reports", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.closingReports.delete(companyId, id);
    return { data };
  }
}
