import { Module } from "@nestjs/common";
import { EmployeeSchedulesController } from "./employee-schedules.controller";
import { EmployeeSchedulesService } from "./employee-schedules.service";

@Module({
  controllers: [EmployeeSchedulesController],
  providers: [EmployeeSchedulesService],
  exports: [EmployeeSchedulesService],
})
export class EmployeeSchedulesModule {}
