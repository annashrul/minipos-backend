import { Module } from "@nestjs/common";
import { StockModule } from "@/modules/stock/stock.module";
import { StockUsageController } from "./stock-usage.controller";
import { StockUsageService } from "./stock-usage.service";
import { StockUsageRepository } from "./stock-usage.repository";

@Module({
  imports: [StockModule],
  controllers: [StockUsageController],
  providers: [StockUsageService, StockUsageRepository],
  exports: [StockUsageService],
})
export class StockUsageModule {}
