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
  CreateCategorySchema,
  ListCategoriesQuerySchema,
  UpdateCategorySchema,
  type CreateCategoryDto,
  type ListCategoriesQueryDto,
  type UpdateCategoryDto,
} from "./dto/categories.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { CategoriesService } from "./categories.service";

@Controller("categories")
@UseGuards(AccessGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireAccess("categories", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListCategoriesQuerySchema))
    query: ListCategoriesQueryDto,
  ) {
    const data = await this.categories.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("categories", "view")
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.categories.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("categories", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("categories", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: CreateCategoryDto,
  ) {
    const data = await this.categories.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("categories", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema)) body: UpdateCategoryDto,
  ) {
    const data = await this.categories.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("categories", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.delete(companyId, id);
    return { data };
  }
}
