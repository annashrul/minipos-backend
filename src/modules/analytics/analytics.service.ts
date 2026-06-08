import { Injectable } from "@nestjs/common";
import { toDateOnly } from "@/common/utils/date";
import { round2 } from "@/common/utils/math";
import type {
  ActivePromotionResponse,
  AppliedPromoResponse,
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
} from "./dto/analytics.dto";
import { AnalyticsRepository } from "./analytics.repository";

@Injectable()
export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository) {}

  // ===========================
  // Margin analyzers
  // ===========================

  async getMarginAnalysis(
    companyId: string,
    _branchId?: string,
  ): Promise<MarginProductResponse[]> {
    const products = await this.repo.findActiveProductsWithCategory(companyId);

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      stock: p.stock,
      category: p.category ? { name: p.category.name } : null,
      margin: p.sellingPrice - p.purchasePrice,
      marginPercent:
        p.purchasePrice > 0
          ? ((p.sellingPrice - p.purchasePrice) / p.purchasePrice) * 100
          : 0,
    }));
  }

  async getCategoryMarginAnalysis(
    companyId: string,
    _branchId?: string,
  ): Promise<CategoryMarginResponse[]> {
    const categories = await this.repo.findCategoriesWithProducts(companyId);

    return categories.map((c) => {
      const totalCost = c.products.reduce((sum, p) => sum + p.purchasePrice, 0);
      const totalSell = c.products.reduce((sum, p) => sum + p.sellingPrice, 0);
      const avgMargin =
        c.products.length > 0
          ? c.products.reduce(
              (sum, p) => sum + (p.sellingPrice - p.purchasePrice),
              0,
            ) / c.products.length
          : 0;
      const totalStock = c.products.reduce((sum, p) => sum + p.stock, 0);

      return {
        name: c.name,
        productCount: c.products.length,
        avgCost: c.products.length > 0 ? totalCost / c.products.length : 0,
        avgSell: c.products.length > 0 ? totalSell / c.products.length : 0,
        avgMargin,
        avgMarginPercent:
          totalCost > 0 ? ((totalSell - totalCost) / totalCost) * 100 : 0,
        totalStock,
      };
    });
  }

  // ===========================
  // Stock detection
  // ===========================

  async getDeadStock(
    companyId: string,
    _branchId?: string,
  ): Promise<DeadStockItemResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [allProducts, recentSales] = await Promise.all([
      this.repo.findActiveProductsWithStock(companyId),
      this.repo.findRecentSoldProductIds(companyId, thirtyDaysAgo),
    ]);

    const soldProductIds = new Set(recentSales.map((s) => s.productId));

    return allProducts
      .filter((p) => !soldProductIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        stock: p.stock,
        sellingPrice: p.sellingPrice,
        category: p.category ? { name: p.category.name } : null,
        stockValue: p.stock * p.sellingPrice,
      }));
  }

  async getSlowMoving(
    companyId: string,
    branchId?: string,
  ): Promise<SlowMovingItemResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const slowRows = await this.repo.findSlowMovingProducts(
      thirtyDaysAgo,
      branchId,
      companyId,
    );

    const slowIds = slowRows.map((r) => r.productId);
    if (slowIds.length === 0) return [];

    const qtyMap = new Map(slowRows.map((r) => [r.productId, r.soldQty]));
    const products = await this.repo.findProductsByIds(slowIds);

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      category: p.category ? { name: p.category.name } : null,
      soldQty: qtyMap.get(p.id) ?? 0,
    }));
  }

  // ===========================
  // Sales trends
  // ===========================

  async getPeakHours(
    companyId: string,
    branchId?: string,
  ): Promise<PeakHourEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await this.repo.findPeakHours(
      thirtyDaysAgo,
      branchId,
      companyId,
    );

    const hourMap = new Map(
      rows.map((r) => [
        r.h,
        { count: Number(r.count), revenue: Number(r.revenue) },
      ]),
    );

    return Array.from({ length: 24 }, (_, h) => {
      const data = hourMap.get(h) || { count: 0, revenue: 0 };
      return {
        hour: `${String(h).padStart(2, "0")}:00`,
        transactions: data.count,
        revenue: data.revenue,
      };
    });
  }

  // ===========================
  // Reorder
  // ===========================

  async getReorderAlerts(
    companyId: string,
    _branchId?: string,
  ): Promise<ReorderAlertResponse[]> {
    return this.repo.findReorderAlerts(companyId);
  }

  async getReorderRecommendations(
    companyId: string,
    _branchId?: string,
  ): Promise<ReorderRecommendationResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const lowStockProducts = await this.repo.findLowStockProducts(companyId);

    const productIds = lowStockProducts.map((p) => p.id);
    const salesAgg =
      productIds.length > 0
        ? await this.repo.findSalesAggByProductIds(productIds, thirtyDaysAgo)
        : [];

    const salesMap = new Map(
      salesAgg.map((s) => [s.productId, s._sum.quantity || 0]),
    );

    const results = lowStockProducts.map((p) => {
      const totalSold = salesMap.get(p.id) || 0;
      const avgDailySales = totalSold / 30;
      const daysUntilOut =
        avgDailySales > 0
          ? Math.round(p.stock / avgDailySales)
          : p.stock > 0
            ? 999
            : 0;
      const recommendedQty = Math.max(p.minStock * 2 - p.stock, 0);

      return {
        product: p.name,
        code: p.code,
        currentStock: p.stock,
        minStock: p.minStock,
        avgDailySales: round2(avgDailySales),
        daysUntilOut,
        recommendedQty,
        supplier: p.supplierName || "-",
      };
    });

    return results.sort((a, b) => a.daysUntilOut - b.daysUntilOut);
  }

  // ===========================
  // Fraud detection
  // ===========================

  async getVoidAbuseDetection(
    companyId: string,
    _branchId?: string,
  ): Promise<VoidAbuseEntryResponse[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rows = await this.repo.findVoidAbuse(sevenDaysAgo, companyId);

    return rows.map((r) => ({
      userName: r.name,
      role: r.role,
      voidCount: r.voidCount,
      suspicious: r.voidCount > 5,
    }));
  }

  async getUnusualDiscounts(
    companyId: string,
    _branchId?: string,
  ): Promise<UnusualDiscountResponse[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const transactions = await this.repo.findUnusualDiscounts(
      sevenDaysAgo,
      companyId,
    );

    return transactions.map((tx) => ({
      invoiceNumber: tx.invoiceDisplayNumber || tx.invoiceNumber,
      cashier: tx.cashierName,
      role: tx.role,
      subtotal: tx.subtotal,
      discountAmount: tx.discountAmount,
      discountPercent: (tx.discountAmount / tx.subtotal) * 100,
      grandTotal: tx.grandTotal,
      createdAt: tx.createdAt,
    }));
  }

  // ===========================
  // Profit
  // ===========================

  async getDailyProfit(
    companyId: string,
    _branchId?: string,
  ): Promise<DailyProfitEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await this.repo.findDailyProfit(thirtyDaysAgo, companyId);

    return rows.map((r) => ({
      date: toDateOnly(r.d),
      revenue: Number(r.revenue),
      cost: Number(r.cost),
      profit: Number(r.revenue) - Number(r.cost),
    }));
  }

  async getShiftProfit(
    companyId: string,
    _branchId?: string,
  ): Promise<ShiftProfitEntry[]> {
    const shifts = await this.repo.findClosedShifts(companyId);
    if (shifts.length === 0) return [];

    const rows = await this.repo.findShiftRevenues(shifts.map((s) => s.id));
    const rowMap = new Map(rows.map((r) => [r.shiftId, r]));

    return shifts.map((shift) => {
      const agg = rowMap.get(shift.id) ?? { revenue: 0, txCount: 0 };
      return {
        shiftId: shift.id,
        cashier: shift.user.name,
        openedAt: shift.openedAt.toISOString(),
        closedAt: (shift.closedAt as Date).toISOString(),
        revenue: agg.revenue,
        transactions: agg.txCount,
      };
    });
  }

  // ===========================
  // Suppliers
  // ===========================

  async getSupplierRanking(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierRankingResponse[]> {
    return this.repo.findSupplierRanking(companyId) as Promise<
      SupplierRankingResponse[]
    >;
  }

  async getSupplierDebt(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierDebtResponse[]> {
    return this.repo.findSupplierDebt(companyId) as Promise<
      SupplierDebtResponse[]
    >;
  }

  // ===========================
  // Promo effectiveness
  // ===========================

  async getPromoEffectiveness(
    companyId: string,
    _branchId?: string,
  ): Promise<PromoEffectivenessResponse[]> {
    const [promotions, txAgg] = await Promise.all([
      this.repo.findPromotions(companyId),
      this.repo.findPromoTxAgg(),
    ]);

    const txMap = new Map(txAgg.map((r) => [r.promoApplied, r]));

    return promotions
      .map((promo) => {
        const key = promo.voucherCode ?? promo.name;
        const agg = txMap.get(key) ?? { usageCount: 0, totalDiscount: 0 };
        return {
          promoName: promo.name,
          type: promo.type,
          usageCount: Math.max(agg.usageCount, promo.usageCount),
          totalDiscount: agg.totalDiscount,
          isActive: promo.isActive && new Date(promo.endDate) >= new Date(),
        };
      })
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  // ===========================
  // Cashier performance
  // ===========================

  async getCashierPerformance(
    companyId: string,
    _branchId?: string,
  ): Promise<CashierPerformanceEntry[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return this.repo.findCashierPerformance(
      thirtyDaysAgo,
      companyId,
    ) as Promise<CashierPerformanceEntry[]>;
  }

  // ===========================
  // Customer Intelligence
  // ===========================

  async getRepeatCustomers(
    companyId: string,
    _branchId?: string,
  ): Promise<RepeatCustomerResponse[]> {
    const customers = await this.repo.findRepeatCustomers(companyId);

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      memberLevel: c.memberLevel,
      totalSpending: c.totalSpending,
      points: c.points,
      transactionCount: c._count.transactions,
      isRepeat: c._count.transactions > 1,
    }));
  }

  async getCustomerFavorites(
    customerId: string,
    _branchId?: string,
  ): Promise<CustomerFavoriteResponse[]> {
    const items = await this.repo.findCustomerFavorites(customerId);

    return items.map((i) => ({
      productName: i.productName,
      productId: i.productId,
      totalQty: i._sum.quantity || 0,
      totalSpent: i._sum.subtotal || 0,
      purchaseCount: i._count,
    }));
  }

  async getShoppingFrequency(
    companyId: string,
    _branchId?: string,
  ): Promise<ShoppingFrequencyCustomerResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const customers = await this.repo.findShoppingFrequencyCustomers(
      companyId,
      thirtyDaysAgo,
    );

    return customers
      .map((c) => {
        const txCount = c.transactions.length;
        const totalSpent = c.transactions.reduce(
          (sum, tx) => sum + tx.grandTotal,
          0,
        );
        const lastVisit = c.transactions[0]?.createdAt ?? null;
        const avgSpending = txCount > 0 ? totalSpent / txCount : 0;

        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          memberLevel: c.memberLevel,
          visitCount: txCount,
          totalSpent,
          avgSpending,
          lastVisit: lastVisit ? lastVisit.toISOString() : null,
        };
      })
      .sort((a, b) => b.visitCount - a.visitCount);
  }

  async getLoyaltySummary(
    companyId: string,
    _branchId?: string,
  ): Promise<LoyaltySummaryResponse[]> {
    const levels = await this.repo.findLoyaltySummary(companyId);

    return levels.map((l) => ({
      level: l.memberLevel,
      count: l._count,
      totalSpending: l._sum.totalSpending || 0,
      totalPoints: l._sum.points || 0,
    }));
  }

  // ===========================
  // Promo Engine
  // ===========================

  async getActivePromotions(
    companyId: string,
  ): Promise<ActivePromotionResponse[]> {
    const now = new Date();
    const promos = await this.repo.findActivePromotions(companyId, now);

    return promos.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      value: p.value,
      minPurchase: p.minPurchase,
      maxDiscount: p.maxDiscount,
      scope: p.scope,
      categoryId: p.categoryId,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      productId: p.productId,
      product: p.product ? { id: p.product.id, name: p.product.name } : null,
      buyQty: p.buyQty,
      getQty: p.getQty,
      getProductId: p.getProductId,
      voucherCode: p.voucherCode,
      description: p.description,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
    }));
  }

  async calculateAutoPromo(
    companyId: string,
    body: CalculateAutoPromoDto,
  ): Promise<CalculateAutoPromoResponse> {
    const { items, subtotal } = body;
    const now = new Date();
    const promotions = await this.repo.findAutoPromotions(companyId, now);

    const appliedPromos: AppliedPromoResponse[] = [];
    let totalDiscount = 0;
    const productIdsForPrice = promotions
      .map((promo) => promo.getProductId)
      .filter((id): id is string => Boolean(id));
    const giftProductInfoMap =
      productIdsForPrice.length > 0
        ? new Map(
            (
              await this.repo.findProductsByIdsWithPrice(
                Array.from(new Set(productIdsForPrice)),
              )
            ).map((p) => [p.id, p]),
          )
        : new Map<
            string,
            { id: string; name: string; code: string; sellingPrice: number }
          >();
    const productPriceMap = new Map<string, number>(
      Array.from(giftProductInfoMap.values()).map((p) => [p.id, p.sellingPrice]),
    );

    const itemsByProductId = new Map<string, typeof items>();
    const itemsByCategoryId = new Map<string, typeof items>();
    for (const item of items) {
      const pArr = itemsByProductId.get(item.productId) ?? [];
      pArr.push(item);
      itemsByProductId.set(item.productId, pArr);
      if (item.categoryId) {
        const cArr = itemsByCategoryId.get(item.categoryId) ?? [];
        cArr.push(item);
        itemsByCategoryId.set(item.categoryId, cArr);
      }
    }

    const findQualifiedItems = (promo: {
      productId: string | null;
      categoryId: string | null;
    }) => {
      if (promo.productId)
        return itemsByProductId.get(promo.productId) ?? [];
      if (promo.categoryId)
        return itemsByCategoryId.get(promo.categoryId) ?? [];
      return items;
    };

    const capDiscount = (value: number, maxDiscount: number | null) => {
      if (!maxDiscount) return value;
      return value > maxDiscount ? maxDiscount : value;
    };

    for (const promo of promotions) {
      if (promo.minPurchase && subtotal < promo.minPurchase) continue;
      const qualifiedItems = findQualifiedItems(promo);
      if (qualifiedItems.length === 0) continue;

      if (promo.type === "DISCOUNT_PERCENT") {
        const baseAmount =
          promo.productId || promo.categoryId
            ? qualifiedItems.reduce((sum, item) => sum + item.subtotal, 0)
            : subtotal;
        const disc = capDiscount(
          Math.round(baseAmount * (promo.value / 100)),
          promo.maxDiscount,
        );
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "DISCOUNT_AMOUNT") {
        const disc = capDiscount(promo.value, promo.maxDiscount);
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "BUY_X_GET_Y") {
        const buyQty = promo.buyQty || 1;
        const getQty = promo.getQty || 1;
        // Tentukan item pemicu promo:
        // - Promo product-specific → hanya produk itu.
        // - Scope kategori/global DENGAN hadiah = produk yang dibeli
        //   (getProductId kosong) → terapkan PER-PRODUK ke setiap item yang
        //   qualified (mis. beli 2 roti gratis 1 roti, beli 2 kue gratis 1 kue).
        // - Scope kategori/global DENGAN hadiah produk TETAP → cukup sekali
        //   (item qualified pertama) supaya hadiah tidak dobel & lineId gift di
        //   frontend (`gift:promoId:giftProductId`) tidak bentrok.
        const isSameProductGift = !promo.getProductId;
        const buyItems = promo.productId
          ? (itemsByProductId.get(promo.productId) ?? []).slice(0, 1)
          : isSameProductGift
            ? qualifiedItems
            : qualifiedItems.slice(0, 1);
        for (const buyItem of buyItems) {
          if (!buyItem || buyItem.quantity < buyQty) continue;
          const multiplier = Math.floor(buyItem.quantity / buyQty);
          const freeItems = multiplier * getQty;
          if (freeItems <= 0) continue;
          const targetProductId = promo.getProductId || buyItem.productId;
          const targetItem = itemsByProductId.get(targetProductId)?.[0];
          const giftInfo = giftProductInfoMap.get(targetProductId);
          const giftName =
            giftInfo?.name || targetItem?.productName || buyItem.productName;
          const freeUnitPrice =
            targetItem?.unitPrice ||
            giftInfo?.sellingPrice ||
            buyItem.unitPrice;
          // BUY_X_GET_Y: hadiah ditambahkan ke cart sebagai line dengan
          // unitPrice=0 (frontend rebuild). Karena gift line gratis, NO
          // monetary discount diperlukan — discountAmount = 0. Promo info
          // tetap dikirim supaya frontend bisa render gift line + label.
          appliedPromos.push({
            promoId: promo.id,
            promoName: promo.name,
            type: promo.type,
            discountAmount: 0,
            appliedTo: buyItem.productId,
            giftProductId: targetProductId,
            giftProductName: giftName,
            giftProductCode: giftInfo?.code ?? null,
            giftQuantity: freeItems,
            giftUnitPrice: freeUnitPrice,
          });
          // totalDiscount tidak ditambah — gift IS the benefit, bukan diskon.
        }
      }
    }

    return { promos: appliedPromos, totalDiscount };
  }

  async validateVoucher(
    companyId: string,
    body: ValidateVoucherDto,
  ): Promise<ValidateVoucherResponse> {
    const { code, subtotal } = body;
    const now = new Date();
    const promo = await this.repo.findVoucher(companyId, code, now);

    if (!promo) return { error: "Voucher tidak valid atau sudah expired" };
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      return { error: "Voucher sudah habis digunakan" };
    }
    if (promo.minPurchase && subtotal < promo.minPurchase) {
      return {
        error: `Minimum pembelian ${promo.minPurchase} untuk voucher ini`,
      };
    }

    let discount = promo.value;
    if (promo.maxDiscount && discount > promo.maxDiscount)
      discount = promo.maxDiscount;

    return {
      success: true,
      promoId: promo.id,
      promoName: promo.name,
      discount,
    };
  }

  async findCustomerByPhone(
    companyId: string,
    phone: string,
  ): Promise<FindCustomerByPhoneResponse> {
    if (!phone || phone.length < 4) return null;

    return this.repo.findCustomerByPhone(companyId, phone);
  }

  async getTebusMurahOptions(
    companyId: string,
    body: TebusMurahOptionsDto,
  ): Promise<TebusMurahOptionResponse[]> {
    const { items, subtotal, selections } = body;
    const now = new Date();
    const promos = await this.repo.findBundlePromotions(companyId, now);

    const productIds = promos.flatMap((promo) => {
      const ids = promo.getProducts.map((gp) => gp.productId);
      if (promo.getProductId) ids.push(promo.getProductId);
      return ids;
    });
    const products = await this.repo.findProductsForTebusMurah(
      Array.from(new Set(productIds)),
    );
    const productMap = new Map(products.map((product) => [product.id, product]));
    // Quota selektif PER promoId (bukan per option). Pilih salah satu produk
    // tebus konsumsi 1 quota promo; option lain auto-berkurang remainingQty-nya.
    const selectedQtyMap = new Map<string, number>();
    for (const sel of selections ?? []) {
      selectedQtyMap.set(
        sel.promoId,
        (selectedQtyMap.get(sel.promoId) ?? 0) + sel.quantity,
      );
    }

    return promos
      .flatMap((promo) => {
        // Daftar produk reward: gabungan multi-reward + legacy single.
        const rewardIds = new Set<string>();
        for (const gp of promo.getProducts) rewardIds.add(gp.productId);
        if (promo.getProductId) rewardIds.add(promo.getProductId);
        return Array.from(rewardIds).map((rewardProductId) =>
          buildOption(promo, rewardProductId),
        );
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    function buildOption(
      promo: (typeof promos)[number],
      rewardProductId: string,
    ): TebusMurahOptionResponse | null {
      // Multi-trigger (any-of): customer beli salah satu produk dari list
      // sudah memenuhi syarat.
      const multiTriggerIds = promo.triggerProducts.map((tp) => tp.productId);
      const hasMultiTrigger = multiTriggerIds.length > 0;
      const triggerQty = hasMultiTrigger
        ? items
            .filter((item) => multiTriggerIds.includes(item.productId))
            .reduce((sum, item) => sum + item.quantity, 0)
        : promo.productId
          ? items
              .filter((item) => item.productId === promo.productId)
              .reduce((sum, item) => sum + item.quantity, 0)
          : promo.categoryId
            ? items
                .filter((item) => item.categoryId === promo.categoryId)
                .reduce((sum, item) => sum + item.quantity, 0)
            : items.reduce((sum, item) => sum + item.quantity, 0);
      const buyQty = promo.buyQty || 1;
      const triggerMultiplier =
        hasMultiTrigger || promo.productId || promo.categoryId
          ? Math.floor(triggerQty / buyQty)
          : 1;
      const minPurchaseMultiplier = promo.minPurchase
        ? Math.floor(subtotal / promo.minPurchase)
        : Number.POSITIVE_INFINITY;
      const eligibleMultiplier = Math.min(
        triggerMultiplier || 0,
        minPurchaseMultiplier,
      );
      const tebusPerMultiplier = promo.getQty || 1;
      const rawMaxQty =
        eligibleMultiplier > 0 ? tebusPerMultiplier * eligibleMultiplier : 0;
      const maxQty = promo.maxDiscount
        ? Math.min(rawMaxQty, Math.floor(promo.maxDiscount))
        : rawMaxQty;
      // Quota di-share di level promo. Pilih option A consume quota; option
      // lain dari promo yang sama otomatis remainingQty berkurang.
      const usedQty = selectedQtyMap.get(promo.id) || 0;
      const remainingQty = Math.max(0, maxQty - usedQty);
      const product = productMap.get(rewardProductId);
      if (!product || remainingQty <= 0) return null;
      return {
        promoId: promo.id,
        promoName: promo.name,
        tebusPrice: promo.value,
        buyQty,
        tebusQty: tebusPerMultiplier,
        maxQty,
        usedQty,
        remainingQty,
        triggerLabel: hasMultiTrigger
          ? `Beli ${buyQty} dari: ${promo.triggerProducts
              .map((tp) => tp.product.name)
              .join(", ")}`
          : promo.product
            ? `Beli ${buyQty} ${promo.product.name}`
            : promo.category
              ? `Beli ${buyQty} produk kategori ${promo.category.name}`
              : promo.minPurchase
                ? `Belanja minimal ${promo.minPurchase}`
                : "Belanja produk promo",
        product: {
          id: product.id,
          name: product.name,
          code: product.code,
          sellingPrice: product.sellingPrice,
          stock: product.stock,
          minStock: product.minStock,
          imageUrl: product.imageUrl,
        },
      };
    }
  }
}
