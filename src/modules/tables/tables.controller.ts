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
  CreateTableSchema,
  ListTablesQuerySchema,
  TableSummaryQuerySchema,
  UpdateTableSchema,
  UpdateTableStatusSchema,
  type CreateTableDto,
  type ListTablesQueryDto,
  type TableSummaryQueryDto,
  type UpdateTableDto,
  type UpdateTableStatusDto,
} from "./dto/tables.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { TablesService } from "./tables.service";

@ApiTags("Tables")
@ApiBearerAuth()
@Controller("tables")
@UseGuards(AccessGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequireAccess("tables", "view")
  @ApiOperation({ summary: "List tables" })
  @ApiZodQuery(ListTablesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTablesQuerySchema))
    query: ListTablesQueryDto,
  ) {
    const data = await this.tables.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("tables", "view")
  @ApiOperation({ summary: "Table summary" })
  @ApiZodQuery(TableSummaryQuerySchema)
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(TableSummaryQuerySchema))
    query: TableSummaryQueryDto,
  ) {
    const data = await this.tables.summary(companyId, query.branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("tables", "view")
  @ApiOperation({ summary: "Get table by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.tables.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("tables", "create")
  @ApiOperation({ summary: "Create table" })
  @ApiZodBody(CreateTableSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateTableSchema)) body: CreateTableDto,
  ) {
    const data = await this.tables.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("tables", "update")
  @ApiOperation({ summary: "Update table" })
  @ApiZodBody(UpdateTableSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateTableSchema)) body: UpdateTableDto,
  ) {
    const data = await this.tables.update(companyId, id, body);
    return { data };
  }

  @Patch(":id/status")
  @RequireAccess("tables", "update")
  @ApiOperation({ summary: "Update table status" })
  @ApiZodBody(UpdateTableStatusSchema)
  async updateStatus(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateTableStatusSchema))
    body: UpdateTableStatusDto,
  ) {
    const data = await this.tables.updateStatus(companyId, id, body.status);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("tables", "delete")
  @ApiOperation({ summary: "Delete table" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.tables.delete(companyId, id);
    return { data };
  }

  @Post(":id/qr-token")
  @RequireAccess("tables", "update")
  @ApiOperation({ summary: "Generate table QR token" })
  async generateQrToken(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.tables.generateQrToken(companyId, id);
    return { data };
  }
}
