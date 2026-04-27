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
  CreateTableSchema,
  ListTablesQuerySchema,
  UpdateTableSchema,
  UpdateTableStatusSchema,
  type CreateTableDto,
  type ListTablesQueryDto,
  type UpdateTableDto,
  type UpdateTableStatusDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { TablesService } from "./tables.service";

@Controller("tables")
@UseGuards(AccessGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequireAccess("tables", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTablesQuerySchema))
    query: ListTablesQueryDto,
  ) {
    const data = await this.tables.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("tables", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.tables.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("tables", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateTableSchema)) body: CreateTableDto,
  ) {
    const data = await this.tables.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("tables", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.tables.delete(companyId, id);
    return { data };
  }
}
