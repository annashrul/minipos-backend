import { Module } from "@nestjs/common";
import { ClosingReportsController } from "./closing-reports.controller";
import { ClosingReportsService } from "./closing-reports.service";

@Module({
  controllers: [ClosingReportsController],
  providers: [ClosingReportsService],
  exports: [ClosingReportsService],
})
export class ClosingReportsModule {}
