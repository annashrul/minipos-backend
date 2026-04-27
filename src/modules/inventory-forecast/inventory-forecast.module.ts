import { Module } from "@nestjs/common";
import { InventoryForecastController } from "./inventory-forecast.controller";
import { InventoryForecastService } from "./inventory-forecast.service";

@Module({
  controllers: [InventoryForecastController],
  providers: [InventoryForecastService],
  exports: [InventoryForecastService],
})
export class InventoryForecastModule {}
