import { Module } from "@nestjs/common";
import { AchievementCalculator } from "./internal/achievement-calculator.service";
import { BadgesService } from "./internal/badges.service";
import { LeaderboardService } from "./internal/leaderboard.service";
import { SalesTargetsCrudService } from "./internal/sales-targets-crud.service";
import { SalesTargetsController } from "./sales-targets.controller";
import { SalesTargetsService } from "./sales-targets.service";

@Module({
  controllers: [SalesTargetsController],
  providers: [
    SalesTargetsService,
    SalesTargetsCrudService,
    LeaderboardService,
    BadgesService,
    AchievementCalculator,
  ],
  exports: [SalesTargetsService],
})
export class SalesTargetsModule {}
