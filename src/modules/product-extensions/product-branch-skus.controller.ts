import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  ReplaceProductBranchSkusSchema,
  type ReplaceProductBranchSkusDto,
} from "./dto/product-branch-skus.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@ApiTags("Product Branch SKUs")
@ApiBearerAuth()
@Controller("products/:productId/branch-skus")
@UseGuards(AccessGuard)
export class ProductBranchSkusController {
  constructor(private readonly service: ProductExtensionsService) {}

  @Get()
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "List product branch SKUs" })
  async list(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listBranchSkus(companyId, productId);
    return { data };
  }

  @Put()
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Replace product branch SKUs" })
  @ApiZodBody(ReplaceProductBranchSkusSchema)
  async replace(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(ReplaceProductBranchSkusSchema))
    body: ReplaceProductBranchSkusDto,
  ) {
    const data = await this.service.replaceBranchSkus(
      companyId,
      productId,
      body,
    );
    return { data };
  }

  // Lookup specific SKU dipakai POS saat resolve harga & stok.
  // Query: ?branchId=X&unitId=Y&variantId=Z (unitId/variantId optional).
  @Get("lookup")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Lookup branch SKU by unit/variant" })
  async lookup(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Query("branchId") branchId: string,
    @Query("unitId") unitId?: string,
    @Query("variantId") variantId?: string,
  ) {
    const data = await this.service.findBranchSku(
      companyId,
      productId,
      branchId,
      unitId || null,
      variantId || null,
    );
    return { data };
  }
}
