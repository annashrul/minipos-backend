import { Module } from "@nestjs/common";
import { CashierBadgesController } from "./badges.controller";
import { CashierFavoritesController } from "./favorites.controller";
import { CashierPerformanceController } from "./performance.controller";
import { CashierService } from "./cashier.service";

@Module({
  controllers: [
    CashierFavoritesController,
    CashierBadgesController,
    CashierPerformanceController,
  ],
  providers: [CashierService],
  exports: [CashierService],
})
export class CashierModule {}
