import { Module } from "@nestjs/common";
import { MarketplaceShopeeController } from "./marketplace-shopee.controller";
import { MarketplaceShopeeRepository } from "./marketplace-shopee.repository";
import { MarketplaceShopeeService } from "./marketplace-shopee.service";
import { ShopeeApiService } from "./shopee-api.service";
import { ShopeeScraperService } from "./shopee-scraper.service";
import { ShopeePlaywrightService } from "./shopee-playwright.service";
import { ShopeeProductSyncService } from "./shopee-product-sync.service";
import { ShopeeStockSyncService } from "./shopee-stock-sync.service";

@Module({
  controllers: [MarketplaceShopeeController],
  providers: [
    MarketplaceShopeeRepository,
    MarketplaceShopeeService,
    ShopeeApiService,
    ShopeeScraperService,
    ShopeePlaywrightService,
    ShopeeProductSyncService,
    ShopeeStockSyncService,
  ],
  exports: [MarketplaceShopeeService],
})
export class MarketplaceShopeeModule {}
