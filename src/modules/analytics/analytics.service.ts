import { Injectable } from "@nestjs/common";
import type {
  ActivePromotionResponse,
  CalculateAutoPromoDto,
  CalculateAutoPromoResponse,
  CashierPerformanceEntry,
  CategoryMarginResponse,
  CustomerFavoriteResponse,
  DailyProfitEntry,
  DeadStockItemResponse,
  FindCustomerByPhoneResponse,
  LoyaltySummaryResponse,
  MarginProductResponse,
  PeakHourEntry,
  PromoEffectivenessResponse,
  RepeatCustomerResponse,
  ReorderAlertResponse,
  ReorderRecommendationResponse,
  ShiftProfitEntry,
  ShoppingFrequencyCustomerResponse,
  SlowMovingItemResponse,
  SupplierDebtResponse,
  SupplierRankingResponse,
  TebusMurahOptionResponse,
  TebusMurahOptionsDto,
  UnusualDiscountResponse,
  ValidateVoucherDto,
  ValidateVoucherResponse,
  VoidAbuseEntryResponse,
} from "@/contracts";
import { InventoryAnalyticsService } from "./internal/inventory-analytics.service";
import { OperationsAnalyticsService } from "./internal/operations-analytics.service";
import { PromoEngineService } from "./internal/promo-engine.service";
import { RelationshipAnalyticsService } from "./internal/relationship-analytics.service";

/**
 * Facade tipis. Delegasi:
 *  - InventoryAnalyticsService    → margin, dead-stock, slow-moving, peak-hours, reorder
 *  - OperationsAnalyticsService   → fraud detection (void/discount), profit harian/shift, cashier performance
 *  - RelationshipAnalyticsService → supplier ranking/debt, promo effectiveness, customer intelligence
 *  - PromoEngineService           → POS promo runtime (auto-promo, voucher, tebus murah, find by phone)
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly inventory: InventoryAnalyticsService,
    private readonly operations: OperationsAnalyticsService,
    private readonly relationship: RelationshipAnalyticsService,
    private readonly promoEngine: PromoEngineService,
  ) {}

  // Inventory
  getMarginAnalysis(
    companyId: string,
    branchId?: string,
  ): Promise<MarginProductResponse[]> {
    return this.inventory.getMarginAnalysis(companyId, branchId);
  }
  getCategoryMarginAnalysis(
    companyId: string,
    branchId?: string,
  ): Promise<CategoryMarginResponse[]> {
    return this.inventory.getCategoryMarginAnalysis(companyId, branchId);
  }
  getDeadStock(
    companyId: string,
    branchId?: string,
  ): Promise<DeadStockItemResponse[]> {
    return this.inventory.getDeadStock(companyId, branchId);
  }
  getSlowMoving(
    companyId: string,
    branchId?: string,
  ): Promise<SlowMovingItemResponse[]> {
    return this.inventory.getSlowMoving(companyId, branchId);
  }
  getPeakHours(
    companyId: string,
    branchId?: string,
  ): Promise<PeakHourEntry[]> {
    return this.inventory.getPeakHours(companyId, branchId);
  }
  getReorderAlerts(
    companyId: string,
    branchId?: string,
  ): Promise<ReorderAlertResponse[]> {
    return this.inventory.getReorderAlerts(companyId, branchId);
  }
  getReorderRecommendations(
    companyId: string,
    branchId?: string,
  ): Promise<ReorderRecommendationResponse[]> {
    return this.inventory.getReorderRecommendations(companyId, branchId);
  }

  // Operations
  getVoidAbuseDetection(
    companyId: string,
    branchId?: string,
  ): Promise<VoidAbuseEntryResponse[]> {
    return this.operations.getVoidAbuseDetection(companyId, branchId);
  }
  getUnusualDiscounts(
    companyId: string,
    branchId?: string,
  ): Promise<UnusualDiscountResponse[]> {
    return this.operations.getUnusualDiscounts(companyId, branchId);
  }
  getDailyProfit(
    companyId: string,
    branchId?: string,
  ): Promise<DailyProfitEntry[]> {
    return this.operations.getDailyProfit(companyId, branchId);
  }
  getShiftProfit(
    companyId: string,
    branchId?: string,
  ): Promise<ShiftProfitEntry[]> {
    return this.operations.getShiftProfit(companyId, branchId);
  }
  getCashierPerformance(
    companyId: string,
    branchId?: string,
  ): Promise<CashierPerformanceEntry[]> {
    return this.operations.getCashierPerformance(companyId, branchId);
  }

  // Relationship
  getSupplierRanking(
    companyId: string,
    branchId?: string,
  ): Promise<SupplierRankingResponse[]> {
    return this.relationship.getSupplierRanking(companyId, branchId);
  }
  getSupplierDebt(
    companyId: string,
    branchId?: string,
  ): Promise<SupplierDebtResponse[]> {
    return this.relationship.getSupplierDebt(companyId, branchId);
  }
  getPromoEffectiveness(
    companyId: string,
    branchId?: string,
  ): Promise<PromoEffectivenessResponse[]> {
    return this.relationship.getPromoEffectiveness(companyId, branchId);
  }
  getRepeatCustomers(
    companyId: string,
    branchId?: string,
  ): Promise<RepeatCustomerResponse[]> {
    return this.relationship.getRepeatCustomers(companyId, branchId);
  }
  getCustomerFavorites(
    customerId: string,
    branchId?: string,
  ): Promise<CustomerFavoriteResponse[]> {
    return this.relationship.getCustomerFavorites(customerId, branchId);
  }
  getShoppingFrequency(
    companyId: string,
    branchId?: string,
  ): Promise<ShoppingFrequencyCustomerResponse[]> {
    return this.relationship.getShoppingFrequency(companyId, branchId);
  }
  getLoyaltySummary(
    companyId: string,
    branchId?: string,
  ): Promise<LoyaltySummaryResponse[]> {
    return this.relationship.getLoyaltySummary(companyId, branchId);
  }

  // Promo Engine
  getActivePromotions(companyId: string): Promise<ActivePromotionResponse[]> {
    return this.promoEngine.getActivePromotions(companyId);
  }
  calculateAutoPromo(
    companyId: string,
    body: CalculateAutoPromoDto,
  ): Promise<CalculateAutoPromoResponse> {
    return this.promoEngine.calculateAutoPromo(companyId, body);
  }
  validateVoucher(
    companyId: string,
    body: ValidateVoucherDto,
  ): Promise<ValidateVoucherResponse> {
    return this.promoEngine.validateVoucher(companyId, body);
  }
  findCustomerByPhone(
    companyId: string,
    phone: string,
  ): Promise<FindCustomerByPhoneResponse> {
    return this.promoEngine.findCustomerByPhone(companyId, phone);
  }
  getTebusMurahOptions(
    companyId: string,
    body: TebusMurahOptionsDto,
  ): Promise<TebusMurahOptionResponse[]> {
    return this.promoEngine.getTebusMurahOptions(companyId, body);
  }
}
