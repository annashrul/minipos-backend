import { Module } from "@nestjs/common";
import { PlansController } from "./plans.controller";
import { PlansService } from "./plans.service";
import { PlansRepository } from "./plans.repository";

@Module({
  controllers: [PlansController],
  providers: [PlansService, PlansRepository],
  exports: [PlansService],
})
export class PlansModule {}
