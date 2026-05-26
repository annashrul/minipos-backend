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
  CreateBrandSchema,
  ListBrandsQuerySchema,
  UpdateBrandSchema,
  type CreateBrandDto,
  type ListBrandsQueryDto,
  type UpdateBrandDto,
} from "./dto/brands.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { BrandsService } from "./brands.service";

@Controller("brands")
@UseGuards(AccessGuard)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequireAccess("brands", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBrandsQuerySchema))
    query: ListBrandsQueryDto,
  ) {
    const data = await this.brands.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("brands", "view")
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.brands.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("brands", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.brands.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("brands", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBrandSchema)) body: CreateBrandDto,
  ) {
    const data = await this.brands.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("brands", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBrandSchema)) body: UpdateBrandDto,
  ) {
    const data = await this.brands.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("brands", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.brands.delete(companyId, id);
    return { data };
  }
}
