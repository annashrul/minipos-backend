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
  ReplaceProductVariantsSchema,
  type ReplaceProductVariantsDto,
} from "./dto/product-variants.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@ApiTags("Product Variants")
@ApiBearerAuth()
@Controller("products/:productId/variants")
@UseGuards(AccessGuard)
export class ProductVariantsController {
  constructor(private readonly service: ProductExtensionsService) {}

  // List semua variant untuk produk ini.
  @Get()
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "List product variants" })
  async list(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listVariants(companyId, productId);
    return { data };
  }

  // Replace seluruh list variant — payload menggambarkan kondisi akhir.
  @Put()
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Replace product variants" })
  @ApiZodBody(ReplaceProductVariantsSchema)
  async replace(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(ReplaceProductVariantsSchema))
    body: ReplaceProductVariantsDto,
  ) {
    const data = await this.service.replaceVariants(
      companyId,
      productId,
      body,
    );
    return { data };
  }

  // Lookup variant berdasar kombinasi optionIds (dipakai POS modifier picker).
  // Query: ?optionIds=id1,id2,id3
  @Get("lookup")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Lookup variant by option IDs" })
  async lookup(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Query("optionIds") optionIds: string | undefined,
  ) {
    const ids = (optionIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await this.service.findVariantByOptions(
      companyId,
      productId,
      ids,
    );
    return { data };
  }
}
