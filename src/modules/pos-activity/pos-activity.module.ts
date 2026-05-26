import { Module } from "@nestjs/common";
import { PosActivityController } from "./pos-activity.controller";
import { PosActivityService } from "./pos-activity.service";
import { PosActivityRepository } from "./pos-activity.repository";

@Module({
  controllers: [PosActivityController],
  providers: [PosActivityService, PosActivityRepository],
  exports: [PosActivityService],
})
export class PosActivityModule {}
