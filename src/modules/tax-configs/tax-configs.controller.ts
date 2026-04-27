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
  CreateTaxConfigSchema,
  ListTaxConfigsQuerySchema,
  UpdateTaxConfigSchema,
  type CreateTaxConfigDto,
  type ListTaxConfigsQueryDto,
  type UpdateTaxConfigDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { TaxConfigsService } from "./tax-configs.service";

@Controller("tax-configs")
@UseGuards(AccessGuard)
export class TaxConfigsController {
  constructor(private readonly taxes: TaxConfigsService) {}

  @Get()
  @RequireAccess("tax-configs", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTaxConfigsQuerySchema))
    query: ListTaxConfigsQueryDto,
  ) {
    const data = await this.taxes.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("tax-configs", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.taxes.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("tax-configs", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateTaxConfigSchema))
    body: CreateTaxConfigDto,
  ) {
    const data = await this.taxes.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("tax-configs", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateTaxConfigSchema))
    body: UpdateTaxConfigDto,
  ) {
    const data = await this.taxes.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("tax-configs", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.taxes.delete(companyId, id);
    return { data };
  }
}
