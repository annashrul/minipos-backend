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
  CreateCategorySchema,
  ListCategoriesQuerySchema,
  UpdateCategorySchema,
  type CreateCategoryDto,
  type ListCategoriesQueryDto,
  type UpdateCategoryDto,
} from "./dto/categories.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { CategoriesService } from "./categories.service";

@ApiTags("Categories")
@ApiBearerAuth()
@Controller("categories")
@UseGuards(AccessGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireAccess("categories", "view")
  @ApiOperation({ summary: "List categories" })
  @ApiZodQuery(ListCategoriesQuerySchema)
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
  @ApiOperation({ summary: "Category summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.categories.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("categories", "view")
  @ApiOperation({ summary: "Get category by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("categories", "delete")
  @ApiOperation({ summary: "Bulk delete categories" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.categories.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Post()
  @RequireAccess("categories", "create")
  @ApiOperation({ summary: "Create category" })
  @ApiZodBody(CreateCategorySchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: CreateCategoryDto,
  ) {
    const data = await this.categories.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("categories", "update")
  @ApiOperation({ summary: "Update category" })
  @ApiZodBody(UpdateCategorySchema)
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
  @ApiOperation({ summary: "Delete category" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.delete(companyId, id);
    return { data };
  }
}
