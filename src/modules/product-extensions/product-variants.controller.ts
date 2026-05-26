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
  ReplaceProductVariantsSchema,
  type ReplaceProductVariantsDto,
} from "./dto/product-variants.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@Controller("products/:productId/variants")
@UseGuards(AccessGuard)
export class ProductVariantsController {
  constructor(private readonly service: ProductExtensionsService) {}

  // List semua variant untuk produk ini.
  @Get()
  @RequireAccess("products", "view")
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
