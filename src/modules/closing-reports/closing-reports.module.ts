import { Module } from "@nestjs/common";
import { ClosingReportsController } from "./closing-reports.controller";
import { ClosingReportsService } from "./closing-reports.service";
import { ClosingReportsRepository } from "./closing-reports.repository";

@Module({
  controllers: [ClosingReportsController],
  providers: [ClosingReportsService, ClosingReportsRepository],
  exports: [ClosingReportsService],
})
export class ClosingReportsModule {}
