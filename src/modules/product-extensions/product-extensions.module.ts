import { Module } from "@nestjs/common";
import { BranchPricesController } from "./branch-prices.controller";
import { ProductExtensionsService } from "./product-extensions.service";
import { ProductTierPricesController } from "./product-tier-prices.controller";
import { ProductUnitsController } from "./product-units.controller";
import { ProductVariantsController } from "./product-variants.controller";
import { ProductBranchSkusController } from "./product-branch-skus.controller";

@Module({
  controllers: [
    ProductUnitsController,
    ProductTierPricesController,
    BranchPricesController,
    ProductVariantsController,
    ProductBranchSkusController,
  ],
  providers: [ProductExtensionsService],
  exports: [ProductExtensionsService],
})
export class ProductExtensionsModule {}
