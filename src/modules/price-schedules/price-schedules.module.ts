import { Module } from "@nestjs/common";
import { PriceSchedulesController } from "./price-schedules.controller";
import { PriceSchedulesService } from "./price-schedules.service";

@Module({
  controllers: [PriceSchedulesController],
  providers: [PriceSchedulesService],
  exports: [PriceSchedulesService],
})
export class PriceSchedulesModule {}
