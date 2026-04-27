import { Module } from "@nestjs/common";
import { BranchPricesController } from "./branch-prices.controller";
import { ProductExtensionsService } from "./product-extensions.service";
import { ProductTierPricesController } from "./product-tier-prices.controller";
import { ProductUnitsController } from "./product-units.controller";

@Module({
  controllers: [
    ProductUnitsController,
    ProductTierPricesController,
    BranchPricesController,
  ],
  providers: [ProductExtensionsService],
  exports: [ProductExtensionsService],
})
export class ProductExtensionsModule {}
