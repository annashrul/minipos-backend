import { Module } from "@nestjs/common";
import { ClosingReportsController } from "./closing-reports.controller";
import { ClosingReportsService } from "./closing-reports.service";
import { ClosingReportsQueryService } from "./internal/closing-reports-query.service";
import { ClosingReportsWriteService } from "./internal/closing-reports-write.service";

@Module({
  controllers: [ClosingReportsController],
  providers: [
    ClosingReportsService,
    ClosingReportsQueryService,
    ClosingReportsWriteService,
  ],
  exports: [ClosingReportsService],
})
export class ClosingReportsModule {}
