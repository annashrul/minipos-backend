import { Injectable } from "@nestjs/common";
import type {
  DashboardAlertsResponse,
  DashboardExtendedStatsQueryDto,
  DashboardExtendedStatsResponse,
  DashboardListQueryDto,
  DashboardStatsQueryDto,
  DashboardStatsResponse,
  ExpiringListResponse,
  LowStockListResponse,
} from "@/contracts";
import { DashboardExtendedService } from "./internal/dashboard-extended.service";
import { DashboardStatsService } from "./internal/dashboard-stats.service";
import { DashboardStockService } from "./internal/dashboard-stock.service";

/**
 * Facade tipis. Delegasi:
 *  - DashboardStatsService    → stats (hourlyTrend dipakai untuk period=today)
 *  - DashboardExtendedService → extendedStats (orchestrator paralel ~12+ query)
 *  - DashboardStockService    → lowStock / expiring / alerts
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly statsService: DashboardStatsService,
    private readonly extendedService: DashboardExtendedService,
    private readonly stockService: DashboardStockService,
  ) {}

  stats(
    companyId: string,
    query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResponse> {
    return this.statsService.stats(companyId, query);
  }

  extendedStats(
    companyId: string,
    query: DashboardExtendedStatsQueryDto,
  ): Promise<DashboardExtendedStatsResponse> {
    return this.extendedService.extendedStats(companyId, query);
  }

  lowStock(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<LowStockListResponse> {
    return this.stockService.lowStock(companyId, query);
  }

  expiring(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<ExpiringListResponse> {
    return this.stockService.expiring(companyId, query);
  }

  alerts(companyId: string): Promise<DashboardAlertsResponse> {
    return this.stockService.alerts(companyId);
  }
}
