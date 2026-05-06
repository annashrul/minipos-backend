import { z } from "zod";

// Schema input untuk satu ingredient di dalam resep.
export const RecipeIngredientInputSchema = z.object({
  ingredientId: z.string().min(1, "Pilih ingredient"),
  quantity: z.number().positive("Qty harus > 0"),
  unit: z.string().min(1).default("pcs"),
  notes: z.string().nullable().optional(),
});
export type RecipeIngredientInputDto = z.infer<
  typeof RecipeIngredientInputSchema
>;

// Upsert resep — satu request mengganti seluruh isi resep produk tsb.
// Hanya boleh dipakai pada Product (bukan SERVICE / bundle).
export const UpsertRecipeSchema = z.object({
  yieldQty: z.number().positive("Yield harus > 0").default(1),
  notes: z.string().nullable().optional(),
  ingredients: z.array(RecipeIngredientInputSchema).min(
    1,
    "Tambah minimal 1 ingredient",
  ),
});
export type UpsertRecipeDto = z.infer<typeof UpsertRecipeSchema>;

// Response shape — dipakai juga di FE.
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
  // Kalkulasi turunan — server-side biar konsisten.
  costPerYield: number; // total harga beli ingredient / yieldQty
  costPerPortion: number; // alias supaya UI tidak perlu hitung sendiri
  createdAt: string;
  updatedAt: string;
};

// Query untuk endpoint /recipes/yield-estimates — semua filter / sort /
// pagination diproses server-side supaya client tinggal render.
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

// Response untuk endpoint /recipes/yield-estimates — estimasi berapa porsi
// tiap menu bisa dibuat dari stok ingredient saat ini.
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
  // Pagination
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

// Response endpoint /recipes/yield-summary — agregat lintas SEMUA menu untuk
// KPI cards & filter pill counts. Endpoint terpisah supaya saat user
// filter/search/paginate, summary tidak ikut di-recompute (cukup fetch sekali
// per branch / per perubahan stok).
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
