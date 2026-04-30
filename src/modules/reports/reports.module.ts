import { Module } from "@nestjs/common";
import { AgingPLReportService } from "./internal/aging-pl.service";
import { CoreReportsService } from "./internal/core-reports.service";
import { ViewReportsService } from "./internal/view-reports.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    CoreReportsService,
    AgingPLReportService,
    ViewReportsService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
