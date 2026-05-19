import { Module } from "@nestjs/common";
import { RacksController } from "./racks.controller";
import { RacksService } from "./racks.service";
import { RackStockHelperService } from "./rack-stock-helper.service";

@Module({
  controllers: [RacksController],
  providers: [RacksService, RackStockHelperService],
  exports: [RacksService, RackStockHelperService],
})
export class RacksModule {}
