import { z } from "zod";

export const RiskLevelSchema = z.enum([
  "CRITICAL",
  "WARNING",
  "LOW",
  "SAFE",
]);
export type RiskLevelDto = z.infer<typeof RiskLevelSchema>;

export const SalesTrendSchema = z.enum([
  "INCREASING",
  "STABLE",
  "DECREASING",
]);
export type SalesTrendDto = z.infer<typeof SalesTrendSchema>;

export const ForecastSortBySchema = z.enum([
  "daysLeft",
  "avgSales",
  "stock",
  "name",
]);
export type ForecastSortByDto = z.infer<typeof ForecastSortBySchema>;

export const ForecastSortDirSchema = z.enum(["asc", "desc"]);
export type ForecastSortDirDto = z.infer<typeof ForecastSortDirSchema>;

export const InventoryForecastQuerySchema = z.object({
  branchId: z.string().optional(),
  riskLevel: RiskLevelSchema.optional(),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  sortBy: ForecastSortBySchema.optional(),
  sortDir: ForecastSortDirSchema.optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(200).optional(),
});
export type InventoryForecastQueryDto = z.infer<
  typeof InventoryForecastQuerySchema
>;

export const ForecastSummaryQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type ForecastSummaryQueryDto = z.infer<
  typeof ForecastSummaryQuerySchema
>;

export const ProductSalesTrendQuerySchema = z.object({
  productId: z.string().min(1),
  days: z.coerce.number().int().min(1).max(365).default(30),
  branchId: z.string().optional(),
});
export type ProductSalesTrendQueryDto = z.infer<
  typeof ProductSalesTrendQuerySchema
>;

export const AutoReorderQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type AutoReorderQueryDto = z.infer<typeof AutoReorderQuerySchema>;

export type ForecastProductResponse = {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string;
  supplierName: string | null;
  supplierId: string | null;
  currentStock: number;
  minStock: number;
  purchasePrice: number;
  sellingPrice: number;
  avgDailySales: number;
  daysUntilStockout: number;
  recommendedReorderQty: number;
  trend: SalesTrendDto;
  riskLevel: RiskLevelDto;
  totalSold30d: number;
  activeDays30d: number;
};

export type ForecastSummaryResponse = {
  criticalCount: number;
  warningCount: number;
  lowCount: number;
  safeCount: number;
  totalStockValueAtRisk: number;
  productsNeedingReorder: number;
  totalProducts: number;
};

export type DailySalesPointResponse = {
  date: string;
  quantity: number;
};

export type ReorderItemResponse = {
  productId: string;
  productName: string;
  productCode: string;
  currentStock: number;
  avgDailySales: number;
  daysUntilStockout: number;
  recommendedQty: number;
  estimatedCost: number;
  purchasePrice: number;
  riskLevel: RiskLevelDto;
};

export type SupplierReorderGroupResponse = {
  supplierId: string;
  supplierName: string;
  supplierContact: string | null;
  supplierEmail: string | null;
  items: ReorderItemResponse[];
  totalEstimatedCost: number;
};
