import { Module } from "@nestjs/common";
import { MarketplaceGrabController } from "./marketplace-grab.controller";
import { MarketplaceGrabService } from "./marketplace-grab.service";
import { GrabScraperService } from "./grab-scraper.service";
import { MarketplaceGrabCronService } from "./marketplace-grab-cron.service";

@Module({
  controllers: [MarketplaceGrabController],
  providers: [
    MarketplaceGrabService,
    GrabScraperService,
    MarketplaceGrabCronService,
  ],
  exports: [MarketplaceGrabService],
})
export class MarketplaceGrabModule {}
