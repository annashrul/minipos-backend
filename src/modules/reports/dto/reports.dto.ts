import { z } from "zod";

export const ReportGroupBySchema = z.enum(["day", "week", "month"]);
export type ReportGroupByDto = z.infer<typeof ReportGroupBySchema>;

export const ReportRangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  branchId: z.string().optional(),
});
export type ReportRangeQueryDto = z.infer<typeof ReportRangeQuerySchema>;

export const SalesReportQuerySchema = ReportRangeQuerySchema.extend({
  groupBy: ReportGroupBySchema.default("day"),
});
export type SalesReportQueryDto = z.infer<typeof SalesReportQuerySchema>;

export const ProductReportQuerySchema = ReportRangeQuerySchema.extend({
  categoryId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type ProductReportQueryDto = z.infer<typeof ProductReportQuerySchema>;

export const CustomerReportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type CustomerReportQueryDto = z.infer<typeof CustomerReportQuerySchema>;

export const PaymentMethodReportQuerySchema = ReportRangeQuerySchema;
export type PaymentMethodReportQueryDto = z.infer<
  typeof PaymentMethodReportQuerySchema
>;

export const AgingReportQuerySchema = z.object({
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type AgingReportQueryDto = z.infer<typeof AgingReportQuerySchema>;

export const ProfitLossReportQuerySchema = ReportRangeQuerySchema;
export type ProfitLossReportQueryDto = z.infer<
  typeof ProfitLossReportQuerySchema
>;

export type SalesReportSeriesEntry = {
  period: string;
  totalSales: number;
  totalTransactions: number;
  totalRefund: number;
  totalVoid: number;
  netSales: number;
};

export type SalesReportTotals = {
  totalSales: number;
  totalTransactions: number;
  totalRefund: number;
  totalVoid: number;
  netSales: number;
  avgTransaction: number;
};

export type SalesReportResponse = {
  range: { from: string; to: string };
  groupBy: ReportGroupByDto;
  series: SalesReportSeriesEntry[];
  totals: SalesReportTotals;
};

export type ProductReportItem = {
  productId: string;
  code: string;
  name: string;
  qtySold: number;
  revenue: number;
  profitMargin: number;
};

export type ProductReportResponse = {
  range: { from: string; to: string };
  items: ProductReportItem[];
};

export type CustomerReportItem = {
  customerId: string;
  name: string;
  totalSpending: number;
  transactionCount: number;
  avgTransaction: number;
};

export type CustomerReportResponse = {
  range: { from: string; to: string };
  items: CustomerReportItem[];
};

export type PaymentMethodReportItem = {
  method: string;
  count: number;
  amount: number;
  percentage: number;
};

export type PaymentMethodReportResponse = {
  range: { from: string; to: string };
  items: PaymentMethodReportItem[];
  total: number;
};

export type AgingBucketKey =
  | "current"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90+";

export type AgingBucketSummary = {
  bucket: AgingBucketKey;
  count: number;
  totalRemaining: number;
};

export type AgingCustomerEntry = {
  partyId: string | null;
  partyName: string;
  totalRemaining: number;
  worstBucket: AgingBucketKey;
};

export type AgingReportResponse = {
  buckets: AgingBucketSummary[];
  customers: AgingCustomerEntry[];
};

export type ProfitLossExpenseEntry = {
  category: string;
  amount: number;
};

export type ProfitLossReportResponse = {
  range: { from: string; to: string };
  revenue: {
    sales: number;
    otherIncome: number;
    total: number;
  };
  cogs: {
    totalCost: number;
  };
  grossProfit: number;
  grossMargin: number;
  expenses: {
    byCategory: ProfitLossExpenseEntry[];
    total: number;
  };
  netProfit: number;
  netMargin: number;
};
