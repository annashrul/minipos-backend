import { Injectable } from "@nestjs/common";
import type {
  ClosingReportListResponse,
  ClosingReportResponse,
  ListClosingReportsQueryDto,
  RecloseShiftDto,
  UpdateClosingReportDto,
} from "@/contracts";
import { ClosingReportsQueryService } from "./internal/closing-reports-query.service";
import { ClosingReportsWriteService } from "./internal/closing-reports-write.service";

/**
 * Facade tipis. Delegasi:
 *  - ClosingReportsQueryService → list / findById / findByShift
 *  - ClosingReportsWriteService → createFromShift / update / recloseShift / delete
 */
@Injectable()
export class ClosingReportsService {
  constructor(
    private readonly query: ClosingReportsQueryService,
    private readonly write: ClosingReportsWriteService,
  ) {}

  list(
    companyId: string,
    query: ListClosingReportsQueryDto,
  ): Promise<ClosingReportListResponse> {
    return this.query.list(companyId, query);
  }
  findById(companyId: string, id: string): Promise<ClosingReportResponse> {
    return this.query.findById(companyId, id);
  }
  findByShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse | null> {
    return this.query.findByShift(companyId, shiftId);
  }

  createFromShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse> {
    return this.write.createFromShift(companyId, shiftId);
  }
  update(
    companyId: string,
    id: string,
    dto: UpdateClosingReportDto,
  ): Promise<ClosingReportResponse> {
    return this.write.update(companyId, id, dto);
  }
  recloseShift(
    companyId: string,
    id: string,
    dto: RecloseShiftDto,
  ): Promise<ClosingReportResponse> {
    return this.write.recloseShift(companyId, id, dto);
  }
  delete(companyId: string, id: string): Promise<{ success: true }> {
    return this.write.delete(companyId, id);
  }
}
