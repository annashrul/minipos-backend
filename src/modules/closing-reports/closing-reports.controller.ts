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
  ListClosingReportsQuerySchema,
  RecloseShiftSchema,
  UpdateClosingReportSchema,
  type ListClosingReportsQueryDto,
  type RecloseShiftDto,
  type UpdateClosingReportDto,
} from "./dto/closing-reports.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ClosingReportsService } from "./closing-reports.service";

@ApiTags("Closing Reports")
@ApiBearerAuth()
@Controller("closing-reports")
@UseGuards(AccessGuard)
export class ClosingReportsController {
  constructor(private readonly closingReports: ClosingReportsService) {}

  @Get()
  @RequireAccess("closing-reports", "view")
  @ApiOperation({ summary: "List closing reports" })
  @ApiZodQuery(ListClosingReportsQuerySchema)
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
  @ApiOperation({ summary: "Get closing report by shift ID" })
  async findByShift(
    @CurrentCompany() companyId: string,
    @Param("shiftId") shiftId: string,
  ) {
    const data = await this.closingReports.findByShift(companyId, shiftId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("closing-reports", "view")
  @ApiOperation({ summary: "Get closing report by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.closingReports.findById(companyId, id);
    return { data };
  }

  @Post("from-shift/:shiftId")
  @RequireAccess("closing-reports", "create")
  @ApiOperation({ summary: "Create closing report from shift" })
  async createFromShift(
    @CurrentCompany() companyId: string,
    @Param("shiftId") shiftId: string,
  ) {
    const data = await this.closingReports.createFromShift(companyId, shiftId);
    return { data };
  }

  @Post(":shiftId/reclose")
  @RequireAccess("closing-reports", "reclosing")
  @ApiOperation({ summary: "Reclose shift" })
  @ApiZodBody(RecloseShiftSchema)
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
  @ApiOperation({ summary: "Update closing report" })
  @ApiZodBody(UpdateClosingReportSchema)
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
  @ApiOperation({ summary: "Delete closing report" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.closingReports.delete(companyId, id);
    return { data };
  }
}
