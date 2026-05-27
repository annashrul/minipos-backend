import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  CreateTierPriceSchema,
  ReplaceTierPricesSchema,
  UpdateTierPriceSchema,
  type CreateTierPriceDto,
  type ReplaceTierPricesDto,
  type UpdateTierPriceDto,
} from "./dto/product-extensions.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@Controller("products/:productId/tier-prices")
@UseGuards(AccessGuard)
export class ProductTierPricesController {
  constructor(private readonly service: ProductExtensionsService) {}

  @Get()
  @RequireAccess("products", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listTierPrices(companyId, productId);
    return { data };
  }

  @Post()
  @RequireAccess("products", "update")
  async create(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(CreateTierPriceSchema))
    body: CreateTierPriceDto,
  ) {
    const data = await this.service.createTierPrice(
      companyId,
      productId,
      body,
    );
    return { data };
  }

  @Patch(":tierId")
  @RequireAccess("products", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("tierId") tierId: string,
    @Body(new ZodValidationPipe(UpdateTierPriceSchema))
    body: UpdateTierPriceDto,
  ) {
    const data = await this.service.updateTierPrice(
      companyId,
      productId,
      tierId,
      body,
    );
    return { data };
  }

  @Delete(":tierId")
  @RequireAccess("products", "update")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("tierId") tierId: string,
  ) {
    const data = await this.service.deleteTierPrice(
      companyId,
      productId,
      tierId,
    );
    return { data };
  }

  @Put()
  @RequireAccess("products", "update")
  async replace(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(ReplaceTierPricesSchema))
    body: ReplaceTierPricesDto,
  ) {
    const data = await this.service.replaceTierPrices(
      companyId,
      productId,
      body,
    );
    return { data };
  }
}
