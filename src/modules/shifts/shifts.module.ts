import { Module } from "@nestjs/common";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";
import { ShiftsRepository } from "./shifts.repository";

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftsRepository],
  exports: [ShiftsService],
})
export class ShiftsModule {}
