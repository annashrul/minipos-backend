import { Module } from "@nestjs/common";
import { VehiclesController } from "./vehicles.controller";
import { VehiclesRepository } from "./vehicles.repository";
import { VehiclesService } from "./vehicles.service";

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesRepository, VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
