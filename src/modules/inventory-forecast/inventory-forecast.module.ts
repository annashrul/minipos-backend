import { Module } from "@nestjs/common";
import { InventoryForecastController } from "./inventory-forecast.controller";
import { InventoryForecastRepository } from "./inventory-forecast.repository";
import { InventoryForecastService } from "./inventory-forecast.service";

@Module({
  controllers: [InventoryForecastController],
  providers: [InventoryForecastRepository, InventoryForecastService],
  exports: [InventoryForecastService],
})
export class InventoryForecastModule {}
