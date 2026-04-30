import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { InventoryAnalyticsService } from "./internal/inventory-analytics.service";
import { OperationsAnalyticsService } from "./internal/operations-analytics.service";
import { PromoEngineService } from "./internal/promo-engine.service";
import { RelationshipAnalyticsService } from "./internal/relationship-analytics.service";

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    InventoryAnalyticsService,
    OperationsAnalyticsService,
    RelationshipAnalyticsService,
    PromoEngineService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
