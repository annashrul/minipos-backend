import { Injectable } from "@nestjs/common";
import type {
  AutoAwardBadgesResponse,
  CashierBadgeResponse,
  CashierFavoriteResponse,
  CashierPerformanceLeaderboardQueryDto,
  CashierPerformanceListResponse,
  CashierPerformanceQueryDto,
  CashierPerformanceResponse,
  CreateCashierBadgeDto,
  CreateCashierFavoriteDto,
  ReorderCashierFavoritesDto,
  UpdateCashierFavoriteDto,
} from "@/contracts";
import { CashierBadgesService } from "./internal/cashier-badges.service";
import { CashierFavoritesService } from "./internal/cashier-favorites.service";
import { CashierPerformanceService } from "./internal/cashier-performance.service";

/**
 * Facade tipis. Delegasi:
 *  - CashierFavoritesService   → list/create/update/reorder/delete favorite produk kasir
 *  - CashierBadgesService      → list/create/delete + auto-award badges (TOP_SELLER, VOLUME_KING)
 *  - CashierPerformanceService → performance list/leaderboard/me
 */
@Injectable()
export class CashierService {
  constructor(
    private readonly favorites: CashierFavoritesService,
    private readonly badges: CashierBadgesService,
    private readonly performance: CashierPerformanceService,
  ) {}

  // Favorites
  listFavorites(
    companyId: string,
    userId: string,
  ): Promise<CashierFavoriteResponse[]> {
    return this.favorites.listFavorites(companyId, userId);
  }
  createFavorite(
    companyId: string,
    userId: string,
    dto: CreateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    return this.favorites.createFavorite(companyId, userId, dto);
  }
  updateFavorite(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    return this.favorites.updateFavorite(companyId, userId, id, dto);
  }
  reorderFavorites(
    companyId: string,
    userId: string,
    dto: ReorderCashierFavoritesDto,
  ): Promise<CashierFavoriteResponse[]> {
    return this.favorites.reorderFavorites(companyId, userId, dto);
  }
  deleteFavorite(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<{ success: true }> {
    return this.favorites.deleteFavorite(companyId, userId, id);
  }

  // Badges
  listBadges(
    companyId: string,
    userId: string,
  ): Promise<CashierBadgeResponse[]> {
    return this.badges.listBadges(companyId, userId);
  }
  createBadge(
    companyId: string,
    dto: CreateCashierBadgeDto,
  ): Promise<CashierBadgeResponse> {
    return this.badges.createBadge(companyId, dto);
  }
  deleteBadge(companyId: string, id: string): Promise<{ success: true }> {
    return this.badges.deleteBadge(companyId, id);
  }
  autoAwardBadges(
    companyId: string,
    userId?: string,
  ): Promise<AutoAwardBadgesResponse> {
    return this.badges.autoAwardBadges(companyId, userId);
  }

  // Performance
  getPerformance(
    companyId: string,
    query: CashierPerformanceQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    return this.performance.getPerformance(companyId, query);
  }
  getLeaderboard(
    companyId: string,
    query: CashierPerformanceLeaderboardQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    return this.performance.getLeaderboard(companyId, query);
  }
  getMyPerformance(
    companyId: string,
    userId: string,
  ): Promise<CashierPerformanceResponse | null> {
    return this.performance.getMyPerformance(companyId, userId);
  }
}
