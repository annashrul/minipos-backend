import { Module } from "@nestjs/common";
import { PointsController } from "./points.controller";
import { PointsRepository } from "./points.repository";
import { PointsService } from "./points.service";

@Module({
  controllers: [PointsController],
  providers: [PointsService, PointsRepository],
  exports: [PointsService],
})
export class PointsModule {}
