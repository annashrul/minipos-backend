import { Module } from "@nestjs/common";
import { MarketplaceShopeeController } from "./marketplace-shopee.controller";
import { MarketplaceShopeeRepository } from "./marketplace-shopee.repository";
import { MarketplaceShopeeService } from "./marketplace-shopee.service";
import { ShopeeApiService } from "./shopee-api.service";
import { ShopeeScraperService } from "./shopee-scraper.service";
import { ShopeePlaywrightService } from "./shopee-playwright.service";

@Module({
  controllers: [MarketplaceShopeeController],
  providers: [
    MarketplaceShopeeRepository,
    MarketplaceShopeeService,
    ShopeeApiService,
    ShopeeScraperService,
    ShopeePlaywrightService,
  ],
  exports: [MarketplaceShopeeService],
})
export class MarketplaceShopeeModule {}
