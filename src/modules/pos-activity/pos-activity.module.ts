import { Module } from "@nestjs/common";
import { PosActivityController } from "./pos-activity.controller";
import { PosActivityService } from "./pos-activity.service";

@Module({
  controllers: [PosActivityController],
  providers: [PosActivityService],
  exports: [PosActivityService],
})
export class PosActivityModule {}
