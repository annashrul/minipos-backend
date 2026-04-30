import { Module } from "@nestjs/common";
import { CashierBadgesController } from "./badges.controller";
import { CashierService } from "./cashier.service";
import { CashierFavoritesController } from "./favorites.controller";
import { CashierBadgesService } from "./internal/cashier-badges.service";
import { CashierFavoritesService } from "./internal/cashier-favorites.service";
import { CashierPerformanceService } from "./internal/cashier-performance.service";
import { CashierPerformanceController } from "./performance.controller";

@Module({
  controllers: [
    CashierFavoritesController,
    CashierBadgesController,
    CashierPerformanceController,
  ],
  providers: [
    CashierService,
    CashierFavoritesService,
    CashierBadgesService,
    CashierPerformanceService,
  ],
  exports: [CashierService],
})
export class CashierModule {}
