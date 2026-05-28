import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateProductUnitSchema,
  UpdateProductUnitSchema,
  type CreateProductUnitDto,
  type UpdateProductUnitDto,
} from "./dto/product-extensions.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@ApiTags("Product Units")
@ApiBearerAuth()
@Controller("products/:productId/units")
@UseGuards(AccessGuard)
export class ProductUnitsController {
  constructor(private readonly service: ProductExtensionsService) {}

  @Get()
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "List product units" })
  async list(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listUnits(companyId, productId);
    return { data };
  }

  @Post()
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Create product unit" })
  @ApiZodBody(CreateProductUnitSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(CreateProductUnitSchema))
    body: CreateProductUnitDto,
  ) {
    const data = await this.service.createUnit(companyId, productId, body);
    return { data };
  }

  @Patch(":unitId")
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Update product unit" })
  @ApiZodBody(UpdateProductUnitSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("unitId") unitId: string,
    @Body(new ZodValidationPipe(UpdateProductUnitSchema))
    body: UpdateProductUnitDto,
  ) {
    const data = await this.service.updateUnit(
      companyId,
      productId,
      unitId,
      body,
    );
    return { data };
  }

  @Delete(":unitId")
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Delete product unit" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("unitId") unitId: string,
  ) {
    const data = await this.service.deleteUnit(companyId, productId, unitId);
    return { data };
  }
}
