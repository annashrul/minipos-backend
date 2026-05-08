import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ReplaceProductBranchSkusSchema,
  type ReplaceProductBranchSkusDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@Controller("products/:productId/branch-skus")
@UseGuards(AccessGuard)
export class ProductBranchSkusController {
  constructor(private readonly service: ProductExtensionsService) {}

  @Get()
  @RequireAccess("products", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listBranchSkus(companyId, productId);
    return { data };
  }

  @Put()
  @RequireAccess("products", "update")
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
