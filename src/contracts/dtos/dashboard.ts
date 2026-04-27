import { z } from "zod";

export const DashboardPeriodSchema = z.enum([
  "today",
  "yesterday",
  "week",
  "month",
  "year",
]);
export type DashboardPeriodDto = z.infer<typeof DashboardPeriodSchema>;

export const DashboardStatsQuerySchema = z.object({
  branchId: z.string().optional(),
  period: DashboardPeriodSchema.default("today"),
});
export type DashboardStatsQueryDto = z.infer<typeof DashboardStatsQuerySchema>;

export const DashboardExtendedPeriodSchema = z.enum([
  "today",
  "week",
  "month",
  "year",
]);
export type DashboardExtendedPeriodDto = z.infer<
  typeof DashboardExtendedPeriodSchema
>;

export const DashboardExtendedStatsQuerySchema = z.object({
  branchId: z.string().optional(),
  period: DashboardExtendedPeriodSchema.default("today"),
});
export type DashboardExtendedStatsQueryDto = z.infer<
  typeof DashboardExtendedStatsQuerySchema
>;

export const DashboardListQuerySchema = z.object({
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DashboardListQueryDto = z.infer<typeof DashboardListQuerySchema>;

export type DashboardSalesSummary = {
  total: number;
  count: number;
  avg: number;
  comparePrev: {
    total: number;
    change: number;
    changePercent: number;
  };
};

export type DashboardTopProduct = {
  productId: string;
  name: string;
  code: string;
  qty: number;
  revenue: number;
};

export type DashboardTopCustomer = {
  customerId: string;
  name: string;
  totalSpending: number;
  transactionCount: number;
};

export type DashboardPaymentBreakdown = {
  method: string;
  count: number;
  amount: number;
};

export type DashboardHourlyTrendEntry = {
  hour: number;
  sales: number;
  count: number;
};

export type DashboardStatsResponse = {
  period: string;
  range: { from: string; to: string };
  sales: DashboardSalesSummary;
  topProducts: DashboardTopProduct[];
  topCustomers: DashboardTopCustomer[];
  paymentBreakdown: DashboardPaymentBreakdown[];
  hourlyTrend: DashboardHourlyTrendEntry[];
};

export type LowStockBranchEntry = {
  branchId: string;
  branchName: string;
  quantity: number;
  minStock: number;
};

export type LowStockProductResponse = {
  productId: string;
  code: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  branchStocks: LowStockBranchEntry[];
};

export type LowStockListResponse = {
  items: LowStockProductResponse[];
  total: number;
};

export type ExpiringProductResponse = {
  productId: string;
  code: string;
  name: string;
  stock: number;
  unit: string;
  expiryDate: string;
  daysToExpiry: number;
  categoryId: string | null;
  categoryName: string | null;
};

export type ExpiringListResponse = {
  items: ExpiringProductResponse[];
  total: number;
};

export type DashboardAlertsResponse = {
  lowStockCount: number;
  expiringCount: number;
  overdueDebtCount: number;
  pendingApprovalCount: number;
};

// --- Extended stats (covers DashboardStats interface used by web dashboard) ---

export type DashboardRecentTransaction = {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  paymentMethod: string;
  status: string;
  createdAt: string; // ISO
  user: { name: string };
};

export type DashboardTopProductLegacy = {
  productName: string;
  _sum: { quantity: number | null; subtotal: number | null };
};

export type DashboardDailySalesEntry = {
  date: string;
  total: number;
  count: number;
};

export type DashboardYearlyComparisonEntry = {
  month: string;
  thisYear: number;
  lastYear: number;
  thisYearCount: number;
  lastYearCount: number;
};

export type DashboardPaymentBreakdownLegacy = {
  method: string;
  total: number;
  count: number;
};

export type DashboardTopCashier = {
  name: string;
  total: number;
  count: number;
};

export type DashboardCategoryBreakdownEntry = {
  name: string;
  total: number;
  qty: number;
};

export type DashboardHourlySalesEntry = {
  hour: string;
  total: number;
  count: number;
};

export type DashboardLowStockProduct = {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  category: { name: string };
};

export type DashboardBranchPerformanceEntry = {
  branchId: string;
  branchName: string;
  periodSales: number;
  periodTransactions: number;
  prevPeriodSales: number;
  prevPeriodTransactions: number;
};

export type DashboardUpcomingDebtEntry = {
  id: string;
  type: "PAYABLE" | "RECEIVABLE";
  partyName: string;
  totalAmount: number;
  remainingAmount: number;
  status: string;
  dueDate: string | null; // ISO
};

export type DashboardExtendedStatsResponse = {
  todaySales: number;
  todayTransactionCount: number;
  yesterdaySales: number;
  yesterdayTransactionCount: number;
  monthRevenue: number;
  monthTransactionCount: number;
  prevMonthRevenue: number;
  prevMonthTransactionCount: number;
  totalProducts: number;
  totalCustomers: number;
  salesGrowthDay: number;
  salesGrowthMonth: number;
  txGrowthMonth: number;
  lowStockProducts: DashboardLowStockProduct[];
  recentTransactions: DashboardRecentTransaction[];
  topProducts: DashboardTopProductLegacy[];
  dailySales: DashboardDailySalesEntry[];
  yearlyComparison: DashboardYearlyComparisonEntry[];
  paymentBreakdown: DashboardPaymentBreakdownLegacy[];
  topCashiers: DashboardTopCashier[];
  categoryBreakdown: DashboardCategoryBreakdownEntry[];
  hourlySales: DashboardHourlySalesEntry[];
  avgTransactionValue: number;
  todayProfit: number;
  weekSales: number;
  refundCount: number;
  voidCount: number;
  activePromotions: number;
  pendingPurchaseOrders: number;
  branchPerformance: DashboardBranchPerformanceEntry[];
  upcomingDebts: DashboardUpcomingDebtEntry[];
};
