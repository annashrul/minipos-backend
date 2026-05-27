import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import type {
  RecipeResponse,
  RecipeYieldSummaryResponse,
  UpsertRecipeDto,
  YieldEstimateQueryDto,
} from "./dto/recipes.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import type { RecipeYieldRow } from "./dto/recipes.dto";
import {
  RecipesRepository,
  type RawRecipeWithIngredients,
  type RawYieldRecipe,
} from "./recipes.repository";

function toResponse(recipe: RawRecipeWithIngredients): RecipeResponse {
  const totalCost = recipe.ingredients.reduce((sum, i) => {
    const cost = i.ingredient?.purchasePrice ?? 0;
    return sum + cost * i.quantity;
  }, 0);
  const yieldQty = recipe.yieldQty || 1;
  const costPerYield = totalCost / yieldQty;
  return {
    id: recipe.id,
    productId: recipe.productId,
    yieldQty: recipe.yieldQty,
    notes: recipe.notes,
    ingredients: recipe.ingredients.map((i) => ({
      id: i.id,
      ingredientId: i.ingredientId,
      ingredient: i.ingredient
        ? {
            id: i.ingredient.id,
            code: i.ingredient.code,
            name: i.ingredient.name,
            unit: i.ingredient.unit,
            purchasePrice: i.ingredient.purchasePrice,
            stock: i.ingredient.stock,
          }
        : null,
      quantity: i.quantity,
      unit: i.unit,
      notes: i.notes,
    })),
    costPerYield,
    costPerPortion: costPerYield,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

@Injectable()
export class RecipesService {
  constructor(
    private readonly repo: RecipesRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getByProduct(
    companyId: string,
    productId: string,
  ): Promise<RecipeResponse | null> {
    const product = await this.repo.findProductOwnership(productId, companyId);
    if (!product) throw new NotFoundException("Produk tidak ditemukan");

    const recipe = await this.repo.findByProductId(productId);
    return recipe ? toResponse(recipe) : null;
  }

  async upsert(
    companyId: string,
    productId: string,
    dto: UpsertRecipeDto,
  ): Promise<RecipeResponse> {
    const product = await this.repo.findProductForUpsert(productId, companyId);
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    if (product.itemType === "SERVICE") {
      throw new BadRequestException(
        "Tipe SERVICE tidak butuh resep — hanya berlaku untuk PRODUCT",
      );
    }

    const ingredientIds = Array.from(
      new Set(dto.ingredients.map((i) => i.ingredientId)),
    );
    if (ingredientIds.includes(productId)) {
      throw new BadRequestException(
        "Ingredient tidak boleh sama dengan produk resep itu sendiri",
      );
    }
    const foundCount = await this.repo.countProductsByIds(ingredientIds, companyId);
    if (foundCount !== ingredientIds.length) {
      throw new BadRequestException(
        "Salah satu ingredient tidak ditemukan di tenant ini",
      );
    }

    // Replace seluruh recipe + ingredients dalam 1 transaksi.
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const recipe = await tx.recipe.upsert({
        where: { productId },
        create: {
          productId,
          yieldQty: dto.yieldQty,
          notes: dto.notes ?? null,
        },
        update: {
          yieldQty: dto.yieldQty,
          notes: dto.notes ?? null,
        },
      });
      // Replace ingredients: delete existing, insert baru.
      await tx.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
      if (dto.ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((i) => ({
            recipeId: recipe.id,
            ingredientId: i.ingredientId,
            quantity: i.quantity,
            unit: i.unit,
            notes: i.notes ?? null,
          })),
        });
      }
      return tx.recipe.findUniqueOrThrow({
        where: { id: recipe.id },
        include: {
          ingredients: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  unit: true,
                  purchasePrice: true,
                  stock: true,
                  itemType: true,
                },
              },
            },
          },
        },
      });
    });
    return toResponse(result);
  }

  async remove(companyId: string, productId: string): Promise<void> {
    const product = await this.repo.findProductOwnership(productId, companyId);
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    await this.repo.deleteByProductId(productId);
  }

  /**
   * Estimasi berapa porsi tiap menu yang bisa dihasilkan dari stok ingredient
   * saat ini. Algoritma: untuk setiap menu, ambil min(floor(stok_i / qty_i_per_porsi))
   * lintas seluruh ingredient — itulah porsi maksimum sebelum salah satu
   * bahan habis (bottleneck). Branch-aware: kalau branchId di-pass, pakai
   * BranchStock; default-nya pakai stok global Product.
   *
   * Filter / search / sort / pagination semua diproses server-side. Summary
   * (untuk KPI cards + filter pill counts) dihitung dari SEMUA menu sebelum
   * filter di-apply, supaya tidak berubah saat user men-filter.
   */
  async getYieldEstimates(
    companyId: string,
    query: YieldEstimateQueryDto,
  ): Promise<{ branchId: string | null } & PaginatedResponse<RecipeYieldRow>> {
    const {
      branchId,
      search,
      status,
      sortBy = "critical",
      sortDir,
      page,
      limit,
    } = query;

    if (branchId) {
      const branch = await this.repo.findBranchOwnership(branchId, companyId);
      if (!branch) throw new NotFoundException("Branch tidak ditemukan");
    }

    const productNameFilter: Prisma.ProductWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { code: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};
    const recipes = await this.repo.findYieldRecipes(companyId, productNameFilter);

    let branchStockMap: Map<string, number> | null = null;
    if (branchId) {
      const ingredientIds = Array.from(
        new Set(
          recipes.flatMap((r) =>
            r.ingredients.map((i) => i.ingredientId),
          ),
        ),
      );
      branchStockMap =
        ingredientIds.length > 0
          ? await this.repo.findBranchStocks(branchId, ingredientIds)
          : new Map();
    }

    const allRows = buildYieldRows(recipes, branchStockMap);

    let filtered = allRows;
    if (status && status !== "all") {
      filtered = filtered.filter((r) => {
        const h =
          r.maxPortions === 0
            ? "out"
            : r.maxPortions < 10
              ? "limited"
              : "healthy";
        return h === status;
      });
    }

    // SORT.
    const dir = sortDir ?? (sortBy === "revenue" ? "desc" : "asc");
    const cmp = (a: typeof filtered[number], b: typeof filtered[number]) => {
      let v = 0;
      if (sortBy === "revenue") v = a.potentialRevenue - b.potentialRevenue;
      else if (sortBy === "name") v = a.productName.localeCompare(b.productName);
      else v = a.maxPortions - b.maxPortions;
      return dir === "desc" ? -v : v;
    };
    filtered.sort(cmp);

    // PAGINATE.
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      branchId: branchId ?? null,
      ...paginate(items, total, page, limit),
    };
  }

  /**
   * Summary terpisah supaya tidak di-recompute saat user filter/search/paginate
   * di endpoint utama. Reuse helper yang sama untuk hitung allRows.
   */
  async getYieldSummary(
    companyId: string,
    branchId?: string,
  ): Promise<RecipeYieldSummaryResponse> {
    if (branchId) {
      const branch = await this.repo.findBranchOwnership(branchId, companyId);
      if (!branch) throw new NotFoundException("Branch tidak ditemukan");
    }

    const recipes = await this.repo.findSummaryRecipes(companyId);

    let branchStockMap: Map<string, number> | null = null;
    if (branchId) {
      const ingredientIds = Array.from(
        new Set(
          recipes.flatMap((r) =>
            r.ingredients.map((i) => i.ingredientId),
          ),
        ),
      );
      branchStockMap =
        ingredientIds.length > 0
          ? await this.repo.findBranchStocks(branchId, ingredientIds)
          : new Map();
    }

    const byHealth = { healthy: 0, limited: 0, out: 0 };
    let totalPortions = 0;
    let totalRevenue = 0;

    for (const recipe of recipes) {
      const yieldQty = recipe.yieldQty || 1;
      let maxPortions = Number.POSITIVE_INFINITY;
      let hasIngredients = false;
      for (const ri of recipe.ingredients) {
        hasIngredients = true;
        const branchQty = branchStockMap?.get(ri.ingredientId) ?? null;
        const currentStock =
          branchQty !== null ? branchQty : (ri.ingredient?.stock ?? 0);
        const neededPerPortion = ri.quantity / yieldQty;
        const portionsPossible =
          neededPerPortion > 0
            ? Math.floor(currentStock / neededPerPortion)
            : 0;
        if (portionsPossible < maxPortions) maxPortions = portionsPossible;
      }
      const safeMax = !hasIngredients || !Number.isFinite(maxPortions)
        ? 0
        : maxPortions;
      totalPortions += safeMax;
      totalRevenue += safeMax * recipe.product.sellingPrice;
      const h = safeMax === 0 ? "out" : safeMax < 10 ? "limited" : "healthy";
      byHealth[h]++;
    }

    return {
      branchId: branchId ?? null,
      totalMenus: recipes.length,
      totalPortions,
      totalRevenue,
      byHealth,
    };
  }
}

function buildYieldRows(
  recipes: RawYieldRecipe[],
  branchStockMap: Map<string, number> | null,
): RecipeYieldRow[] {
  return recipes.map((recipe) => {
    const yieldQty = recipe.yieldQty || 1;
    const ingredientRows = recipe.ingredients.map((ri) => {
      const branchQty = branchStockMap?.get(ri.ingredientId) ?? null;
      const currentStock =
        branchQty !== null ? branchQty : (ri.ingredient?.stock ?? 0);
      const neededPerPortion = ri.quantity / yieldQty;
      const portionsPossible =
        neededPerPortion > 0
          ? Math.floor(currentStock / neededPerPortion)
          : 0;
      return {
        ingredientId: ri.ingredientId,
        ingredientCode: ri.ingredient?.code ?? "",
        ingredientName: ri.ingredient?.name ?? "(deleted)",
        currentStock,
        unit: ri.unit,
        neededPerPortion,
        portionsPossible,
      };
    });
    const maxPortions =
      ingredientRows.length === 0
        ? 0
        : ingredientRows.reduce(
            (min, r) => Math.min(min, r.portionsPossible),
            Number.POSITIVE_INFINITY,
          );
    const safeMax = Number.isFinite(maxPortions) ? maxPortions : 0;
    const bottleneckRow =
      safeMax === 0
        ? ingredientRows.find((r) => r.portionsPossible === 0) ?? null
        : ingredientRows.find((r) => r.portionsPossible === safeMax) ?? null;
    return {
      productId: recipe.productId,
      productCode: recipe.product.code,
      productName: recipe.product.name,
      sellingPrice: recipe.product.sellingPrice,
      yieldQty,
      maxPortions: safeMax,
      potentialRevenue: safeMax * recipe.product.sellingPrice,
      bottleneck: bottleneckRow
        ? {
            ingredientId: bottleneckRow.ingredientId,
            ingredientName: bottleneckRow.ingredientName,
            currentStock: bottleneckRow.currentStock,
            unit: bottleneckRow.unit,
            neededPerPortion: bottleneckRow.neededPerPortion,
          }
        : null,
      ingredients: ingredientRows,
    };
  });
}
