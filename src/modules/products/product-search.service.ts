import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ProductsRepository } from "./products.repository";

@Injectable()
export class ProductSearchService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Public agar bisa dipakai dari module lain (table-orders public menu)
  // tanpa duplikasi logic BOM expansion.
  async computeRecipeStockByProduct(
    companyId: string,
    productIds: string[],
    branchId?: string,
  ): Promise<Map<string, number>> {
    const uniqueProductIds = Array.from(
      new Set(productIds.filter((id) => id)),
    );
    if (uniqueProductIds.length === 0) return new Map();

    const recipes = await this.repo.findRecipes(companyId, uniqueProductIds);
    if (recipes.length === 0) return new Map();

    let branchStockMap: Map<string, number> | null = null;
    if (branchId) {
      const ingredientIds = Array.from(
        new Set(
          recipes.flatMap((recipe) =>
            recipe.ingredients.map((ingredient) => ingredient.ingredientId),
          ),
        ),
      );
      if (ingredientIds.length > 0) {
        const stocks = await this.repo.findBranchStocks(branchId, companyId, ingredientIds);
        branchStockMap = new Map(
          stocks.map((stock) => [stock.productId, stock.quantity]),
        );
      } else {
        branchStockMap = new Map();
      }
    }

    const stockByProduct = new Map<string, number>();
    for (const recipe of recipes) {
      const yieldQty = recipe.yieldQty || 1;
      let maxPortions = Number.POSITIVE_INFINITY;
      let hasIngredients = false;

      for (const ingredient of recipe.ingredients) {
        hasIngredients = true;
        const currentStock = branchId
          ? (branchStockMap?.get(ingredient.ingredientId) ?? 0)
          : (ingredient.ingredient?.stock ?? 0);
        const neededPerPortion = ingredient.quantity / yieldQty;
        const portionsPossible =
          neededPerPortion > 0
            ? Math.floor(currentStock / neededPerPortion)
            : 0;
        if (portionsPossible < maxPortions) maxPortions = portionsPossible;
      }

      stockByProduct.set(
        recipe.productId,
        !hasIngredients || !Number.isFinite(maxPortions) ? 0 : maxPortions,
      );
    }

    return stockByProduct;
  }

  async findByBarcode(
    companyId: string,
    barcode: string,
    branchId?: string,
  ): Promise<unknown | null> {
    const product = await this.repo.findByBarcodeOrCode(companyId, barcode);
    if (!product) return null;
    const matchedUnit = product.units.find((u) => u.barcode === barcode) ?? null;
    const branchStock = branchId
      ? (
          await this.repo.findBranchStock(product.id, branchId)
        )?.quantity ?? 0
      : undefined;
    const recipeStock = (
      await this.computeRecipeStockByProduct(companyId, [product.id], branchId)
    ).get(product.id);
    const effectiveStock = recipeStock ?? branchStock ?? product.stock;
    return {
      ...product,
      stock: effectiveStock,
      ...(branchStock !== undefined ? { branchStock: effectiveStock } : {}),
      matchedUnit: matchedUnit
        ? {
            id: matchedUnit.id,
            name: matchedUnit.name,
            conversionQty: matchedUnit.conversionQty,
            sellingPrice: matchedUnit.sellingPrice,
            purchasePrice: matchedUnit.purchasePrice,
            barcode: matchedUnit.barcode,
          }
        : null,
    };
  }

  async posSearch(
    companyId: string,
    params: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      limit?: number;
      offset?: number;
      restrictToBranchAssigned?: boolean;
    },
  ): Promise<{ products: unknown[]; total: number }> {
    const { rows, total } = await this.branchView(companyId, {
      branchId: params.branchId,
      search: params.search,
      categoryId: params.categoryId,
      isActive: true,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
      restrictToBranchAssigned: params.restrictToBranchAssigned ?? false,
      excludeIngredient: true,
    });
    const rawRows = rows as Record<string, unknown>[];
    const productIds = rawRows.map((row) => String(row.productId));
    if (productIds.length === 0) return { products: [], total };

    const [units, branchSkus] = await Promise.all([
      this.repo.findUnitsByProducts(productIds),
      params.branchId
        ? this.repo.findActiveBranchSkus(params.branchId, productIds)
        : Promise.resolve([]),
    ]);

    const unitsByProduct = new Map<string, typeof units>();
    for (const unit of units) {
      const current = unitsByProduct.get(unit.productId) ?? [];
      current.push(unit);
      unitsByProduct.set(unit.productId, current);
    }

    const baseSkuByProduct = new Map<string, (typeof branchSkus)[number]>();
    const skuByProductUnit = new Map<string, (typeof branchSkus)[number]>();
    for (const sku of branchSkus) {
      if (sku.variantId) continue;
      if (!sku.unitId) {
        baseSkuByProduct.set(sku.productId, sku);
      } else {
        skuByProductUnit.set(`${sku.productId}:${sku.unitId}`, sku);
      }
    }

    const products = rawRows.map((row) => {
      const productId = String(row.productId);
      const baseSku = baseSkuByProduct.get(productId);
      const productUnits = (unitsByProduct.get(productId) ?? [])
        .filter((unit) => Number(unit.conversionQty) > 1)
        .map((unit) => {
          const sku = skuByProductUnit.get(`${productId}:${unit.id}`);
          return {
            id: unit.id,
            name: unit.name,
            conversionQty: Number(unit.conversionQty),
            sellingPrice: Number(sku?.sellingPrice ?? unit.sellingPrice),
            purchasePrice:
              sku?.purchasePrice ??
              (unit.purchasePrice === null
                ? null
                : Number(unit.purchasePrice)),
            barcode: unit.barcode ?? null,
          };
        });

      return {
        id: productId,
        code: String(row.productCode ?? ""),
        name: String(row.productName ?? ""),
        categoryId: (row.categoryId as string) ?? null,
        category: {
          id: (row.categoryId as string) ?? "",
          name: (row.categoryName as string) ?? "",
        },
        sellingPrice: Number(baseSku?.sellingPrice ?? row.sellingPrice ?? 0),
        purchasePrice: Number(baseSku?.purchasePrice ?? row.purchasePrice ?? 0),
        stock: Number(row.stock ?? 0),
        minStock: Number(row.minStock ?? 0),
        unit: (row.baseUnit as string) ?? "",
        imageUrl: (row.imageUrl as string) ?? null,
        barcode: (row.barcode as string) ?? null,
        ...(productUnits.length > 0 ? { units: productUnits } : {}),
      };
    });

    return { products, total };
  }

  async branchView(
    companyId: string,
    params: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      isActive?: boolean;
      stockStatus?: string;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortDir?: "asc" | "desc";
      onlyWithStock?: boolean;
      restrictToBranchAssigned?: boolean;
      excludeIngredient?: boolean;
      // Exclude PRODUCT items yang punya Recipe — dipakai di product picker
      // inventory (PO, stock-transfer, stock-adjustment). Logikanya: kalau
      // menu sudah punya resep, stoknya derived dari ingredient — tidak
      // boleh di-adjust / di-transfer / di-purchase langsung.
      excludeRecipeProducts?: boolean;
      itemType?: "PRODUCT" | "SERVICE" | "INGREDIENT";
    },
  ): Promise<{ rows: unknown[]; total: number }> {
    const {
      branchId,
      search,
      categoryId,
      brandId,
      isActive,
      stockStatus,
      limit = 20,
      offset = 0,
      sortBy,
      sortDir = "desc",
      onlyWithStock = false,
      restrictToBranchAssigned = false,
      excludeIngredient = false,
      excludeRecipeProducts = false,
      itemType,
    } = params;
    const conditions: string[] = ['"companyId" = $1'];
    const values: unknown[] = [companyId];
    let i = 2;
    if (branchId) {
      conditions.push(`"branchId" = $${i++}`);
      values.push(branchId);
    }
    if (search) {
      conditions.push(
        `("productName" ILIKE $${i} OR "productCode" ILIKE $${i} OR barcode ILIKE $${i} OR "categoryName" ILIKE $${i} OR description ILIKE $${i})`,
      );
      values.push(`%${search}%`);
      i++;
    }
    if (categoryId) {
      conditions.push(`"categoryId" = $${i++}`);
      values.push(categoryId);
    }
    if (brandId) {
      conditions.push(`"brandId" = $${i++}`);
      values.push(brandId);
    }
    if (isActive !== undefined) {
      conditions.push(`"isActive" = $${i++}`);
      values.push(isActive);
    }
    if (stockStatus === "out") conditions.push("stock = 0");
    else if (stockStatus === "low")
      conditions.push("stock > 0 AND stock <= 10");
    else if (stockStatus === "available") conditions.push("stock > 0");
    if (onlyWithStock) conditions.push('"hasBranchStock" = true');
    if (restrictToBranchAssigned && branchId) {
      conditions.push('("hasBranchStock" = true OR "hasBranchPrice" = true)');
    }
    if (excludeIngredient) {
      conditions.push(
        `"productId" NOT IN (SELECT id FROM products WHERE "itemType" = 'INGREDIENT')`,
      );
    }
    if (excludeRecipeProducts) {
      conditions.push(`"productId" NOT IN (SELECT "productId" FROM recipes)`);
    }
    if (itemType) {
      conditions.push(
        `"productId" IN (SELECT id FROM products WHERE "itemType" = $${i++})`,
      );
      values.push(itemType);
    }

    const whereClause = conditions.join(" AND ");
    const dir = sortDir === "asc" ? "ASC" : "DESC";
    const sortColumnByKey: Record<string, string> = {
      name: '"productName"',
      code: '"productCode"',
      category: '"categoryName"',
      purchasePrice: '"purchasePrice"',
      sellingPrice: '"sellingPrice"',
      stock: "stock",
      createdAt: '"createdAt"',
    };
    const sortColumn = sortBy ? sortColumnByKey[sortBy] : undefined;
    const orderBy = sortColumn
      ? `${sortColumn} ${dir}, "productName" ASC`
      : '"createdAt" DESC';
    const groupedOrderBy = sortColumn
      ? `${sortColumn} ${dir}, "productName" ASC`
      : '"createdAt" DESC';
    const countQuery = `SELECT COUNT(DISTINCT "productId")::int AS total FROM vw_product_branch WHERE ${whereClause}`;
    const dataQuery = branchId
      ? `SELECT * FROM vw_product_branch WHERE ${whereClause} ORDER BY ${orderBy} LIMIT $${i} OFFSET $${i + 1}`
      : `SELECT "productId", "productCode", "productName", "categoryId", "categoryName",
                "brandId", "companyId", "baseUnit", "isActive", "imageUrl", barcode, description,
                MIN("branchId") AS "branchId", '' AS "branchName", '' AS "branchCode",
                (SELECT p."sellingPrice" FROM products p WHERE p.id = "productId")::float8 AS "sellingPrice",
                (SELECT p."purchasePrice" FROM products p WHERE p.id = "productId")::float8 AS "purchasePrice",
                (SELECT p.stock FROM products p WHERE p.id = "productId")::int4 AS stock,
                (SELECT p."minStock" FROM products p WHERE p.id = "productId")::int4 AS "minStock",
                bool_or("hasBranchStock") AS "hasBranchStock",
                bool_or("hasBranchPrice") AS "hasBranchPrice",
                MAX("unitCount")::int4 AS "unitCount",
                MAX("variantCount")::int4 AS "variantCount",
                MIN("createdAt") AS "createdAt", MAX("updatedAt") AS "updatedAt"
           FROM vw_product_branch
           WHERE ${whereClause}
           GROUP BY "productId", "productCode", "productName", "categoryId", "categoryName",
                    "brandId", "companyId", "baseUnit", "isActive", "imageUrl", barcode, description
           ORDER BY ${groupedOrderBy}
           LIMIT $${i} OFFSET $${i + 1}`;
    const [total, rawRows] = await Promise.all([
      this.repo.branchViewCount(countQuery, values),
      this.repo.branchViewData(dataQuery, [...values, limit, offset]),
    ]);

    // Augment rows with default_rack info (raw SQL view doesn't include it).
    const productIds = Array.from(
      new Set(rawRows.map((r) => String(r.productId))),
    ).filter((id) => id);
    const rackInfoByProduct = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        branchId: string;
      } | null
    >();
    if (productIds.length > 0) {
      const productsWithRack = await this.repo.findProductsWithRack(companyId, productIds);
      for (const p of productsWithRack) {
        rackInfoByProduct.set(p.id, p.defaultRack ?? null);
      }
    }
    const recipeStockByProduct = await this.computeRecipeStockByProduct(
      companyId,
      productIds,
      branchId,
    );
    const rows = rawRows.map((r) => {
      const productId = String(r.productId);
      const rack = rackInfoByProduct.get(productId) ?? null;
      const recipeStock = recipeStockByProduct.get(productId);
      return {
        ...r,
        stock: recipeStock ?? r.stock,
        defaultRackId: rack?.id ?? null,
        defaultRack: rack,
      };
    });

    return { rows, total };
  }
}
