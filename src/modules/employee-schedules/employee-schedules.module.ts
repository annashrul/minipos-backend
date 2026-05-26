import { Module } from "@nestjs/common";
import { EmployeeSchedulesController } from "./employee-schedules.controller";
import { EmployeeSchedulesService } from "./employee-schedules.service";
import { EmployeeSchedulesRepository } from "./employee-schedules.repository";

@Module({
  controllers: [EmployeeSchedulesController],
  providers: [EmployeeSchedulesService, EmployeeSchedulesRepository],
  exports: [EmployeeSchedulesService],
})
export class EmployeeSchedulesModule {}
