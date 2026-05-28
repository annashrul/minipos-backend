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
  CreateBundleSchema,
  ListBundlesQuerySchema,
  UpdateBundleSchema,
  type CreateBundleDto,
  type ListBundlesQueryDto,
  type UpdateBundleDto,
} from "./dto/bundles.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { BundlesService } from "./bundles.service";

@ApiTags("Bundles")
@ApiBearerAuth()
@Controller("bundles")
@UseGuards(AccessGuard)
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @RequireAccess("bundles", "view")
  @ApiOperation({ summary: "List bundles" })
  @ApiZodQuery(ListBundlesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBundlesQuerySchema))
    query: ListBundlesQueryDto,
  ) {
    const data = await this.bundles.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("bundles", "view")
  @ApiOperation({ summary: "Get bundle by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.bundles.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("bundles", "create")
  @ApiOperation({ summary: "Create bundle" })
  @ApiZodBody(CreateBundleSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBundleSchema)) body: CreateBundleDto,
  ) {
    const data = await this.bundles.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("bundles", "update")
  @ApiOperation({ summary: "Update bundle" })
  @ApiZodBody(UpdateBundleSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBundleSchema)) body: UpdateBundleDto,
  ) {
    const data = await this.bundles.update(companyId, id, body);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("bundles", "delete")
  @ApiOperation({ summary: "Bulk delete bundles" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.bundles.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("bundles", "delete")
  @ApiOperation({ summary: "Delete bundle" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.bundles.delete(companyId, id);
    return { data };
  }
}
