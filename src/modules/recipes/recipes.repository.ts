import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const RECIPE_INCLUDE = {
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
} satisfies Prisma.RecipeInclude;

export type RawRecipeWithIngredients = Prisma.RecipeGetPayload<{
  include: typeof RECIPE_INCLUDE;
}>;

const YIELD_RECIPE_INCLUDE = {
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      sellingPrice: true,
    },
  },
  ingredients: {
    include: {
      ingredient: {
        select: {
          id: true,
          code: true,
          name: true,
          stock: true,
          unit: true,
        },
      },
    },
  },
} satisfies Prisma.RecipeInclude;

export type RawYieldRecipe = Prisma.RecipeGetPayload<{
  include: typeof YIELD_RECIPE_INCLUDE;
}>;

const SUMMARY_RECIPE_INCLUDE = {
  product: { select: { sellingPrice: true } },
  ingredients: {
    include: {
      ingredient: { select: { id: true, stock: true } },
    },
  },
} satisfies Prisma.RecipeInclude;

export type RawSummaryRecipe = Prisma.RecipeGetPayload<{
  include: typeof SUMMARY_RECIPE_INCLUDE;
}>;

@Injectable()
export class RecipesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductId(
    productId: string,
  ): Promise<RawRecipeWithIngredients | null> {
    return this.prisma.recipe.findUnique({
      where: { productId },
      include: RECIPE_INCLUDE,
    });
  }

  async findProductOwnership(
    productId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
  }

  async findProductForUpsert(
    productId: string,
    companyId: string,
  ): Promise<{ id: string; itemType: string } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, itemType: true },
    });
  }

  async countProductsByIds(
    ids: string[],
    companyId: string,
  ): Promise<number> {
    return this.prisma.product.count({
      where: { id: { in: ids }, companyId },
    });
  }

  async deleteByProductId(productId: string): Promise<void> {
    await this.prisma.recipe.deleteMany({ where: { productId } });
  }

  async findYieldRecipes(
    companyId: string,
    productNameFilter: Prisma.ProductWhereInput,
  ): Promise<RawYieldRecipe[]> {
    return this.prisma.recipe.findMany({
      where: {
        product: {
          companyId,
          deletedAt: null,
          isActive: true,
          ...productNameFilter,
        },
      },
      include: YIELD_RECIPE_INCLUDE,
    });
  }

  async findBranchStocks(
    branchId: string,
    productIds: string[],
  ): Promise<Map<string, number>> {
    const stocks = await this.prisma.branchStock.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    });
    return new Map(stocks.map((s) => [s.productId, s.quantity]));
  }

  async findBranchOwnership(
    branchId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async findSummaryRecipes(
    companyId: string,
  ): Promise<RawSummaryRecipe[]> {
    return this.prisma.recipe.findMany({
      where: {
        product: { companyId, deletedAt: null, isActive: true },
      },
      include: SUMMARY_RECIPE_INCLUDE,
    });
  }
}
