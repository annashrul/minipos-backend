import { z } from "zod";

export const ProfitPeriodSchema = z.enum(["today", "week", "month", "year"]);
export type ProfitPeriodDto = z.infer<typeof ProfitPeriodSchema>;

export const ProfitOverviewQuerySchema = z.object({
  period: ProfitPeriodSchema.default("month"),
  branchId: z.string().optional(),
});
export type ProfitOverviewQueryDto = z.infer<typeof ProfitOverviewQuerySchema>;

export const ProfitByCategoryQuerySchema = z.object({
  period: ProfitPeriodSchema.default("month"),
  branchId: z.string().optional(),
});
export type ProfitByCategoryQueryDto = z.infer<
  typeof ProfitByCategoryQuerySchema
>;

export const ProfitByProductOrderSchema = z.enum(["top", "bottom"]);
export type ProfitByProductOrderDto = z.infer<typeof ProfitByProductOrderSchema>;

export const ProfitByProductQuerySchema = z.object({
  period: ProfitPeriodSchema.default("month"),
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(10),
  order: ProfitByProductOrderSchema.default("top"),
});
export type ProfitByProductQueryDto = z.infer<
  typeof ProfitByProductQuerySchema
>;

export const ProfitByBranchQuerySchema = z.object({
  period: ProfitPeriodSchema.default("month"),
});
export type ProfitByBranchQueryDto = z.infer<typeof ProfitByBranchQuerySchema>;

export const ProfitTrendQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  branchId: z.string().optional(),
});
export type ProfitTrendQueryDto = z.infer<typeof ProfitTrendQuerySchema>;

export const MarginDistributionQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type MarginDistributionQueryDto = z.infer<
  typeof MarginDistributionQuerySchema
>;

export type ProfitOverviewResponse = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  expenses: number;
  netProfit: number;
  netMargin: number;
  revenueGrowth: number;
  grossProfitGrowth: number;
  netProfitGrowth: number;
  cogsGrowth: number;
  expensesGrowth: number;
  transactionCount: number;
};

export type ProfitByCategoryEntry = {
  category: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  contribution: number;
  units: number;
};

export type ProfitByProductEntry = {
  productName: string;
  productCode: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type ProfitByBranchEntry = {
  branchId: string;
  branchName: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  grossMargin: number;
  netMargin: number;
  contribution: number;
};

export type ProfitTrendEntry = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
};

export type MarginDistributionEntry = {
  label: string;
  count: number;
  revenue: number;
};
