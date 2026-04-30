import { Injectable } from "@nestjs/common";
import type {
  CreateSalesTargetDto,
  EvaluateBadgesDto,
  EvaluateBadgesResponse,
  GetSalesBadgesQueryDto,
  LeaderboardQueryDto,
  LeaderboardResponse,
  ListSalesTargetsQueryDto,
  SalesBadgeResponse,
  SalesTargetListResponse,
  SalesTargetResponse,
  UpdateSalesTargetDto,
} from "@/contracts";
import { BadgesService } from "./internal/badges.service";
import { LeaderboardService } from "./internal/leaderboard.service";
import { SalesTargetsCrudService } from "./internal/sales-targets-crud.service";

/**
 * Facade tipis. Delegasi:
 *  - SalesTargetsCrudService → list/findById/current/create/update/recompute/delete
 *  - LeaderboardService      → leaderboard ranking by revenue
 *  - BadgesService           → CashierBadge listing + auto-award
 */
@Injectable()
export class SalesTargetsService {
  constructor(
    private readonly crud: SalesTargetsCrudService,
    private readonly leaderboardService: LeaderboardService,
    private readonly badges: BadgesService,
  ) {}

  list(
    companyId: string,
    query: ListSalesTargetsQueryDto,
  ): Promise<SalesTargetListResponse> {
    return this.crud.list(companyId, query);
  }
  findById(companyId: string, id: string): Promise<SalesTargetResponse> {
    return this.crud.findById(companyId, id);
  }
  current(companyId: string): Promise<SalesTargetResponse[]> {
    return this.crud.current(companyId);
  }
  create(
    companyId: string,
    userId: string,
    dto: CreateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    return this.crud.create(companyId, userId, dto);
  }
  update(
    companyId: string,
    id: string,
    dto: UpdateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    return this.crud.update(companyId, id, dto);
  }
  recompute(companyId: string, id: string): Promise<SalesTargetResponse> {
    return this.crud.recompute(companyId, id);
  }
  delete(companyId: string, id: string): Promise<{ success: true }> {
    return this.crud.delete(companyId, id);
  }

  leaderboard(
    companyId: string,
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardService.leaderboard(companyId, query);
  }

  listBadges(
    companyId: string,
    query: GetSalesBadgesQueryDto,
  ): Promise<SalesBadgeResponse[]> {
    return this.badges.listBadges(companyId, query);
  }
  evaluateAndAwardBadges(
    companyId: string,
    body: EvaluateBadgesDto,
  ): Promise<EvaluateBadgesResponse> {
    return this.badges.evaluateAndAwardBadges(companyId, body);
  }
}
