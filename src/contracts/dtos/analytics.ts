import { z } from "zod";

// ===========================
// Common Query Schemas
// ===========================

export const AnalyticsBranchQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type AnalyticsBranchQueryDto = z.infer<typeof AnalyticsBranchQuerySchema>;

// ===========================
// Margin Analysis
// ===========================

export type MarginProductResponse = {
  id: string;
  name: string;
  code: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  category: { name: string } | null;
  margin: number;
  marginPercent: number;
};

export type CategoryMarginResponse = {
  name: string;
  productCount: number;
  avgCost: number;
  avgSell: number;
  avgMargin: number;
  avgMarginPercent: number;
  totalStock: number;
};

// ===========================
// Stock Analysis
// ===========================

export type DeadStockItemResponse = {
  id: string;
  name: string;
  code: string;
  stock: number;
  sellingPrice: number;
  category: { name: string } | null;
  stockValue: number;
};

export type SlowMovingItemResponse = {
  id: string;
  name: string;
  code: string;
  stock: number;
  category: { name: string } | null;
  soldQty: number;
};

export type ReorderAlertResponse = {
  id: string;
  name: string;
  code: string;
  stock: number;
  minStock: number;
  supplierName: string | null;
};

export type ReorderRecommendationResponse = {
  product: string;
  code: string;
  currentStock: number;
  minStock: number;
  avgDailySales: number;
  daysUntilOut: number;
  recommendedQty: number;
  supplier: string;
};

// ===========================
// Sales Trends / Peak Hours / Profit
// ===========================

export type PeakHourEntry = {
  hour: string;
  transactions: number;
  revenue: number;
};

export type DailyProfitEntry = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
};

export type ShiftProfitEntry = {
  shiftId: string;
  cashier: string;
  openedAt: string;
  closedAt: string;
  revenue: number;
  transactions: number;
};

export type CashierPerformanceEntry = {
  name: string;
  transactions: number;
  revenue: number;
  avgTransaction: number;
};

// ===========================
// Fraud Detection
// ===========================

export type VoidAbuseEntryResponse = {
  userName: string;
  role: string;
  voidCount: number;
  suspicious: boolean;
};

export type UnusualDiscountResponse = {
  invoiceNumber: string;
  cashier: string;
  role: string;
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  grandTotal: number;
  createdAt: string;
};

// ===========================
// Suppliers
// ===========================

export type SupplierRankingResponse = {
  name: string;
  productCount: number;
  totalPOValue: number;
  poCount: number;
};

export type SupplierDebtResponse = {
  supplierName: string;
  totalPO: number;
  totalPaid: number;
  debt: number;
};

// ===========================
// Promotions Effectiveness
// ===========================

export type PromoEffectivenessResponse = {
  promoName: string;
  type: string;
  usageCount: number;
  totalDiscount: number;
  isActive: boolean;
};

// ===========================
// Customer Intelligence
// ===========================

export type RepeatCustomerResponse = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  memberLevel: string;
  totalSpending: number;
  points: number;
  transactionCount: number;
  isRepeat: boolean;
};

export type CustomerFavoriteResponse = {
  productName: string;
  productId: string;
  totalQty: number;
  totalSpent: number;
  purchaseCount: number;
};

export type ShoppingFrequencyCustomerResponse = {
  id: string;
  name: string;
  phone: string | null;
  memberLevel: string;
  visitCount: number;
  totalSpent: number;
  avgSpending: number;
  lastVisit: string | null;
};

export type LoyaltySummaryResponse = {
  level: string;
  count: number;
  totalSpending: number;
  totalPoints: number;
};

// ===========================
// Promo Engine
// ===========================

export const PromoCartItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  categoryId: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  subtotal: z.number(),
});
export type PromoCartItemDto = z.infer<typeof PromoCartItemSchema>;

export const TebusSelectionSchema = z.object({
  promoId: z.string(),
  quantity: z.number(),
});
export type TebusSelectionDto = z.infer<typeof TebusSelectionSchema>;

export const CalculateAutoPromoSchema = z.object({
  items: z.array(PromoCartItemSchema),
  subtotal: z.number().nonnegative(),
});
export type CalculateAutoPromoDto = z.infer<typeof CalculateAutoPromoSchema>;

export const ValidateVoucherSchema = z.object({
  code: z.string().min(1),
  subtotal: z.number().nonnegative(),
});
export type ValidateVoucherDto = z.infer<typeof ValidateVoucherSchema>;

export const TebusMurahOptionsSchema = z.object({
  items: z.array(PromoCartItemSchema),
  subtotal: z.number().nonnegative(),
  selections: z.array(TebusSelectionSchema).optional().default([]),
});
export type TebusMurahOptionsDto = z.infer<typeof TebusMurahOptionsSchema>;

export const FindCustomerByPhoneQuerySchema = z.object({
  phone: z.string(),
});
export type FindCustomerByPhoneQueryDto = z.infer<
  typeof FindCustomerByPhoneQuerySchema
>;

export type ActivePromotionResponse = {
  id: string;
  name: string;
  type: string;
  value: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  scope: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  productId: string | null;
  product: { id: string; name: string } | null;
  buyQty: number | null;
  getQty: number | null;
  getProductId: string | null;
  voucherCode: string | null;
  description: string | null;
  startDate: string;
  endDate: string;
};

export type AppliedPromoResponse = {
  promoId: string;
  promoName: string;
  type: string;
  discountAmount: number;
  appliedTo: string;
};

export type CalculateAutoPromoResponse = {
  promos: AppliedPromoResponse[];
  totalDiscount: number;
};

export type ValidateVoucherSuccessResponse = {
  success: true;
  promoId: string;
  promoName: string;
  discount: number;
};

export type ValidateVoucherErrorResponse = {
  error: string;
};

export type ValidateVoucherResponse =
  | ValidateVoucherSuccessResponse
  | ValidateVoucherErrorResponse;

export type FindCustomerByPhoneResponse = {
  id: string;
  name: string;
  phone: string | null;
  memberLevel: string;
  points: number;
  totalSpending: number;
  memberCardCode: string | null;
} | null;

export type TebusMurahOptionResponse = {
  promoId: string;
  promoName: string;
  tebusPrice: number;
  buyQty: number;
  tebusQty: number;
  maxQty: number;
  usedQty: number;
  remainingQty: number;
  triggerLabel: string;
  product: {
    id: string;
    name: string;
    code: string;
    sellingPrice: number;
    stock: number;
    minStock: number;
    imageUrl: string | null;
  };
};
