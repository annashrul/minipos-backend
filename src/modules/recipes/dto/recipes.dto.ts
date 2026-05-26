import { z } from "zod";

export const RecipeIngredientInputSchema = z.object({
  ingredientId: z.string().min(1, "Pilih ingredient"),
  quantity: z.number().positive("Qty harus > 0"),
  unit: z.string().min(1).default("pcs"),
  notes: z.string().nullable().optional(),
});
export type RecipeIngredientInputDto = z.infer<
  typeof RecipeIngredientInputSchema
>;

export const UpsertRecipeSchema = z.object({
  yieldQty: z.number().positive("Yield harus > 0").default(1),
  notes: z.string().nullable().optional(),
  ingredients: z.array(RecipeIngredientInputSchema).min(
    1,
    "Tambah minimal 1 ingredient",
  ),
});
export type UpsertRecipeDto = z.infer<typeof UpsertRecipeSchema>;

export type RecipeIngredientResponse = {
  id: string;
  ingredientId: string;
  ingredient: {
    id: string;
    code: string;
    name: string;
    unit: string;
    purchasePrice: number;
    stock: number;
  } | null;
  quantity: number;
  unit: string;
  notes: string | null;
};

export type RecipeResponse = {
  id: string;
  productId: string;
  yieldQty: number;
  notes: string | null;
  ingredients: RecipeIngredientResponse[];
  costPerYield: number;
  costPerPortion: number;
  createdAt: string;
  updatedAt: string;
};

export const YieldEstimateQuerySchema = z.object({
  branchId: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(["all", "healthy", "limited", "out"]).optional(),
  sortBy: z.enum(["critical", "revenue", "name"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
});
export type YieldEstimateQueryDto = z.infer<typeof YieldEstimateQuerySchema>;

export type RecipeYieldIngredient = {
  ingredientId: string;
  ingredientCode: string;
  ingredientName: string;
  currentStock: number;
  unit: string;
  neededPerPortion: number;
  portionsPossible: number;
};

export type RecipeYieldRow = {
  productId: string;
  productCode: string;
  productName: string;
  sellingPrice: number;
  yieldQty: number;
  maxPortions: number;
  potentialRevenue: number;
  bottleneck: {
    ingredientId: string;
    ingredientName: string;
    currentStock: number;
    unit: string;
    neededPerPortion: number;
  } | null;
  ingredients: RecipeYieldIngredient[];
};

export type RecipeYieldEstimatesResponse = {
  branchId: string | null;
  items: RecipeYieldRow[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    count: number;
  };
};

export type RecipeYieldSummaryResponse = {
  branchId: string | null;
  totalMenus: number;
  totalPortions: number;
  totalRevenue: number;
  byHealth: {
    healthy: number;
    limited: number;
    out: number;
  };
};

export const YieldSummaryQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type YieldSummaryQueryDto = z.infer<typeof YieldSummaryQuerySchema>;
