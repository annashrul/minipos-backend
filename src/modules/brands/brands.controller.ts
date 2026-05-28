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
  CreateBrandSchema,
  ListBrandsQuerySchema,
  UpdateBrandSchema,
  type CreateBrandDto,
  type ListBrandsQueryDto,
  type UpdateBrandDto,
} from "./dto/brands.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { BrandsService } from "./brands.service";

@ApiTags("Brands")
@ApiBearerAuth()
@Controller("brands")
@UseGuards(AccessGuard)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequireAccess("brands", "view")
  @ApiOperation({ summary: "List brands" })
  @ApiZodQuery(ListBrandsQuerySchema)
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
  @ApiOperation({ summary: "Brand summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.brands.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("brands", "view")
  @ApiOperation({ summary: "Get brand by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.brands.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("brands", "delete")
  @ApiOperation({ summary: "Bulk delete brands" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.brands.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Post()
  @RequireAccess("brands", "create")
  @ApiOperation({ summary: "Create brand" })
  @ApiZodBody(CreateBrandSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBrandSchema)) body: CreateBrandDto,
  ) {
    const data = await this.brands.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("brands", "update")
  @ApiOperation({ summary: "Update brand" })
  @ApiZodBody(UpdateBrandSchema)
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
  @ApiOperation({ summary: "Delete brand" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.brands.delete(companyId, id);
    return { data };
  }
}
