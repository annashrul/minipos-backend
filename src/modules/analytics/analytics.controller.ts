import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AnalyticsBranchQuerySchema,
  CalculateAutoPromoSchema,
  FindCustomerByPhoneQuerySchema,
  TebusMurahOptionsSchema,
  ValidateVoucherSchema,
  type AnalyticsBranchQueryDto,
  type CalculateAutoPromoDto,
  type FindCustomerByPhoneQueryDto,
  type TebusMurahOptionsDto,
  type ValidateVoucherDto,
} from "./dto/analytics.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
@UseGuards(AccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // -----------------------------------
  // Margin / Stock analyzers
  // -----------------------------------

  @Get("margin/products")
  @RequireAccess("analytics", "view")
  async marginProducts(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getMarginAnalysis(companyId, query.branchId);
    return { data };
  }

  @Get("margin/categories")
  @RequireAccess("analytics", "view")
  async marginCategories(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getCategoryMarginAnalysis(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("dead-stock")
  @RequireAccess("analytics", "view")
  async deadStock(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getDeadStock(companyId, query.branchId);
    return { data };
  }

  @Get("slow-moving")
  @RequireAccess("analytics", "view")
  async slowMoving(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getSlowMoving(companyId, query.branchId);
    return { data };
  }

  @Get("peak-hours")
  @RequireAccess("analytics", "view")
  async peakHours(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getPeakHours(companyId, query.branchId);
    return { data };
  }

  @Get("reorder-alerts")
  @RequireAccess("analytics", "view")
  async reorderAlerts(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getReorderAlerts(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("reorder-recommendations")
  @RequireAccess("analytics", "view")
  async reorderRecommendations(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getReorderRecommendations(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Fraud / discount detection
  // -----------------------------------

  @Get("void-abuse")
  @RequireAccess("analytics", "view")
  async voidAbuse(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getVoidAbuseDetection(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("unusual-discounts")
  @RequireAccess("analytics", "view")
  async unusualDiscounts(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getUnusualDiscounts(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Profit
  // -----------------------------------

  @Get("profit/daily")
  @RequireAccess("analytics", "view")
  async dailyProfit(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getDailyProfit(companyId, query.branchId);
    return { data };
  }

  @Get("profit/shifts")
  @RequireAccess("analytics", "view")
  async shiftProfit(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getShiftProfit(companyId, query.branchId);
    return { data };
  }

  // -----------------------------------
  // Suppliers
  // -----------------------------------

  @Get("suppliers/ranking")
  @RequireAccess("analytics", "view")
  async supplierRanking(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getSupplierRanking(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("suppliers/debt")
  @RequireAccess("analytics", "view")
  async supplierDebt(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getSupplierDebt(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Promo effectiveness
  // -----------------------------------

  @Get("promo-effectiveness")
  @RequireAccess("analytics", "view")
  async promoEffectiveness(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getPromoEffectiveness(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Cashier performance
  // -----------------------------------

  @Get("cashier-performance")
  @RequireAccess("analytics", "view")
  async cashierPerformance(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getCashierPerformance(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Customer Intelligence
  // -----------------------------------

  @Get("repeat-customers")
  @RequireAccess("customer-intelligence", "view")
  async repeatCustomers(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getRepeatCustomers(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("customer-favorites/:customerId")
  @RequireAccess("customer-intelligence", "view")
  async customerFavorites(
    @Param("customerId") customerId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getCustomerFavorites(
      customerId,
      query.branchId,
    );
    return { data };
  }

  @Get("shopping-frequency")
  @RequireAccess("customer-intelligence", "view")
  async shoppingFrequency(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getShoppingFrequency(
      companyId,
      query.branchId,
    );
    return { data };
  }

  @Get("loyalty-summary")
  @RequireAccess("customer-intelligence", "view")
  async loyaltySummary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AnalyticsBranchQuerySchema))
    query: AnalyticsBranchQueryDto,
  ) {
    const data = await this.analytics.getLoyaltySummary(
      companyId,
      query.branchId,
    );
    return { data };
  }

  // -----------------------------------
  // Promo Engine (POS)
  // -----------------------------------

  @Get("promo-engine/active")
  async activePromotions(@CurrentCompany() companyId: string) {
    const data = await this.analytics.getActivePromotions(companyId);
    return { data };
  }

  @Post("promo-engine/auto")
  async calculateAutoPromo(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CalculateAutoPromoSchema))
    body: CalculateAutoPromoDto,
  ) {
    const data = await this.analytics.calculateAutoPromo(companyId, body);
    return { data };
  }

  @Post("promo-engine/voucher")
  async validateVoucher(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(ValidateVoucherSchema))
    body: ValidateVoucherDto,
  ) {
    const data = await this.analytics.validateVoucher(companyId, body);
    return { data };
  }

  @Get("promo-engine/customer-by-phone")
  async findCustomerByPhone(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(FindCustomerByPhoneQuerySchema))
    query: FindCustomerByPhoneQueryDto,
  ) {
    const data = await this.analytics.findCustomerByPhone(
      companyId,
      query.phone,
    );
    return { data };
  }

  @Post("promo-engine/tebus-murah")
  async tebusMurahOptions(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(TebusMurahOptionsSchema))
    body: TebusMurahOptionsDto,
  ) {
    const data = await this.analytics.getTebusMurahOptions(companyId, body);
    return { data };
  }
}
