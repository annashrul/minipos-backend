import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductResponse,
  UpdateProductDto,
} from "./dto/products.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ProductsRepository, type RawProduct } from "./products.repository";

const INT32_MAX = 2_147_483_647;

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly prisma: PrismaService,
  ) {}

  private async computeRecipeStockByProduct(
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

  async list(
    companyId: string,
    query: ListProductsQueryDto,
  ): Promise<PaginatedResponse<ProductResponse>> {
    const {
      search,
      categoryId,
      brandId,
      supplierId,
      itemType,
      excludeIngredient,
      isActive,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;
    const where: Prisma.ProductWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (supplierId) where.supplierId = supplierId;
    if (itemType) where.itemType = itemType;
    if (excludeIngredient) {
      where.itemType = { not: "INGREDIENT" };
    }
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.ProductOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "category":
          orderBy = { category: { name: dir } };
          break;
        case "name":
        case "code":
        case "purchasePrice":
        case "sellingPrice":
        case "stock":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.ProductOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toProductResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<ProductResponse> {
    const product = await this.repo.findOne({ id, companyId });
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    return toProductResponse(product);
  }

  async findDetail(companyId: string, id: string, branchId?: string) {
    const product = await this.repo.findOne({ id, companyId });
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    const [units, branchSkus, tierPrices, variants, modifierGroups, branches] =
      await Promise.all([
        this.repo.findProductUnits(id),
        this.repo.findBranchSkus(id, branchId),
        this.repo.findTierPrices(id),
        this.repo.findVariants(id),
        this.repo.findModifierGroups(id),
        this.repo.findBranches(companyId),
      ]);

    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));
    const unitNameMap = new Map(units.map((u) => [u.id, u.name]));
    const variantLabelMap = new Map(
      variants.map((v) => [
        v.id,
        v.options.map((o) => o.option.name).join(" · "),
      ]),
    );

    let effectiveBranchSkus: typeof branchSkus = branchSkus;
    if (branchSkus.length === 0) {
      const [legacyPrices, legacyStocks] = await Promise.all([
        this.repo.findLegacyPrices(id, branchId),
        this.repo.findLegacyStocks(id, branchId),
      ]);
      const priceByBranch = new Map(
        legacyPrices.map((p) => [p.branchId, p]),
      );
      const stockByBranch = new Map(
        legacyStocks.map((s) => [s.branchId, s]),
      );
      const branchIds = new Set([
        ...legacyPrices.map((p) => p.branchId),
        ...legacyStocks.map((s) => s.branchId),
      ]);
      effectiveBranchSkus = [...branchIds].map((branchId) => {
        const pr = priceByBranch.get(branchId);
        const st = stockByBranch.get(branchId);
        return {
          id: `legacy:${branchId}`,
          branchId,
          unitId: null,
          variantId: null,
          sellingPrice: pr?.sellingPrice ?? product.sellingPrice ?? 0,
          purchasePrice:
            pr?.purchasePrice ?? product.purchasePrice ?? 0,
          stock: st?.quantity ?? 0,
          minStock: st?.minStock ?? product.minStock ?? 5,
          barcode: null,
          isActive: true,
        };
      });
    }

    const enrichedBranchSkus = effectiveBranchSkus.map((s) => ({
      ...s,
      branchName: branchNameMap.get(s.branchId) ?? null,
      unitName: s.unitId ? unitNameMap.get(s.unitId) ?? null : null,
      variantLabel: s.variantId ? variantLabelMap.get(s.variantId) ?? null : null,
    }));

    return {
      ...toProductResponse(product),
      units,
      branchSkus: enrichedBranchSkus,
      tierPrices,
      variants: variants.map((v) => ({
        id: v.id,
        isActive: v.isActive,
        optionIds: v.options.map((o) => o.optionId),
        label: v.options.map((o) => o.option.name).join(" · "),
      })),
      modifierGroupIds: modifierGroups.map((mg) => mg.modifierGroupId),
    };
  }

  private async syncProductModifierGroups(
    companyId: string,
    productId: string,
    modifierGroupIds: string[],
  ): Promise<void> {
    if (modifierGroupIds.length > 0) {
      const owned = await this.repo.findOwnedModifierGroups(companyId, modifierGroupIds);
      if (owned.length !== modifierGroupIds.length) {
        throw new BadRequestException(
          "Satu atau lebih grup modifier tidak valid",
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productModifierGroup.deleteMany({ where: { productId } });
      if (modifierGroupIds.length > 0) {
        await tx.productModifierGroup.createMany({
          data: modifierGroupIds.map((modifierGroupId, idx) => ({
            productId,
            modifierGroupId,
            sortOrder: idx,
          })),
        });
      }
    });
  }

  private async generateProductCode(companyId: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const candidate = `PRD-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(-3)}`;
      const exists = await this.repo.findExists({ companyId, code: candidate });
      if (!exists) return candidate;
    }
    return `PRD-${Date.now().toString(36).toUpperCase()}`;
  }

  async create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    try {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await this.generateProductCode(companyId);
      const created = await this.repo.create({
        code,
        name: dto.name,
        categoryId: dto.categoryId,
        brandId: dto.brandId ?? null,
        supplierId: dto.supplierId ?? null,
        companyId,
        purchasePrice: dto.purchasePrice,
        sellingPrice: dto.sellingPrice,
        stock: dto.stock ?? 0,
        minStock: dto.minStock ?? 5,
        barcode: dto.barcode ?? null,
        unit: dto.unit ?? "pcs",
        itemType: dto.itemType ?? "PRODUCT",
        isActive: dto.isActive ?? true,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        defaultRackId: dto.defaultRackId ?? null,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          created.id,
          dto.modifierGroupIds,
        );
      }
      if (dto.productUnits !== undefined) {
        await this.replaceProductUnits(created.id, dto.productUnits);
      }
      if (dto.tierPrices !== undefined) {
        await this.replaceTierPrices(created.id, dto.tierPrices);
      }
      if (dto.branchSkus !== undefined) {
        await this.replaceBranchSkusInline(created.id, dto.branchSkus);
      }
      return toProductResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Kode atau barcode produk sudah digunakan");
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const existing = await this.repo.findExists({ id, companyId });
    if (!existing) throw new NotFoundException("Produk tidak ditemukan");

    const data: Prisma.ProductUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.brandId !== undefined) {
      data.brand = dto.brandId
        ? { connect: { id: dto.brandId } }
        : { disconnect: true };
    }
    if (dto.supplierId !== undefined) {
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    }
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.minStock !== undefined) data.minStock = dto.minStock;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.itemType !== undefined) data.itemType = dto.itemType;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.defaultRackId !== undefined) {
      data.defaultRack = dto.defaultRackId
        ? { connect: { id: dto.defaultRackId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.repo.update(id, data);
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          id,
          dto.modifierGroupIds,
        );
      }
      if (dto.productUnits !== undefined) {
        await this.replaceProductUnits(id, dto.productUnits);
      }
      if (dto.tierPrices !== undefined) {
        await this.replaceTierPrices(id, dto.tierPrices);
      }
      if (dto.branchSkus !== undefined) {
        await this.replaceBranchSkusInline(id, dto.branchSkus);
      }
      return toProductResponse(updated);
    } catch (err) {
      throwIfUniqueConstraint(err, "Kode atau barcode produk sudah digunakan");
    }
  }

  private async replaceProductUnits(
    productId: string,
    units: NonNullable<UpdateProductDto["productUnits"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productUnit.deleteMany({ where: { productId } });
      if (units.length === 0) return;
      await tx.productUnit.createMany({
        data: units.map((u, i) => ({
          productId,
          name: u.name,
          conversionQty: u.conversionQty,
          sellingPrice: u.sellingPrice ?? 0,
          purchasePrice: u.purchasePrice ?? null,
          barcode: u.barcode || null,
          isDefault: u.conversionQty === 1 && i === 0,
          sortOrder: i,
        })),
      });
    });
  }

  private async replaceTierPrices(
    productId: string,
    tiers: NonNullable<UpdateProductDto["tierPrices"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productTierPrice.deleteMany({ where: { productId } });
      if (tiers.length === 0) return;
      await tx.productTierPrice.createMany({
        data: tiers.map((t) => ({
          productId,
          minQty: t.minQty,
          price: t.price,
        })),
      });
    });
  }

  private async replaceBranchSkusInline(
    productId: string,
    items: NonNullable<UpdateProductDto["branchSkus"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const units = await tx.productUnit.findMany({
        where: { productId },
        select: { id: true, name: true, conversionQty: true },
        orderBy: { conversionQty: "asc" },
      });
      const unitIdByName = new Map<string, string>();
      for (const u of units) {
        unitIdByName.set(u.name, u.id);
      }

      const variantCandidates = await tx.productVariant.findMany({
        where: { productId },
        include: { options: { select: { optionId: true } } },
      });
      const variantIdBySignature = new Map<string, string>(
        variantCandidates.map((v) => [
          v.options.map((o) => o.optionId).sort().join("|"),
          v.id,
        ]),
      );

      const resolved: Array<{
        branchId: string;
        unitId: string | null;
        variantId: string | null;
        sellingPrice: number;
        purchasePrice: number;
        stock: number;
        minStock: number;
        barcode: string | null;
        isActive: boolean;
      }> = [];
      for (const item of items) {
        let unitId: string | null = null;
        if (item.unitName) {
          const id = unitIdByName.get(item.unitName);
          if (!id) {
            throw new BadRequestException(
              `Satuan "${item.unitName}" tidak ditemukan untuk produk ini`,
            );
          }
          unitId = id;
        }
        let variantId: string | null = null;
        if (item.optionIds && item.optionIds.length > 0) {
          const sortedIncoming = [...item.optionIds].sort().join("|");
          const cachedId = variantIdBySignature.get(sortedIncoming);
          if (cachedId) {
            variantId = cachedId;
          } else {
            const created = await tx.productVariant.create({
              data: {
                productId,
                isActive: true,
                options: {
                  create: item.optionIds.map((oid) => ({ optionId: oid })),
                },
              },
            });
            variantId = created.id;
            variantIdBySignature.set(sortedIncoming, created.id);
          }
        }
        resolved.push({
          branchId: item.branchId,
          unitId,
          variantId,
          sellingPrice: item.sellingPrice,
          purchasePrice: item.purchasePrice,
          stock: item.stock ?? 0,
          minStock: item.minStock ?? 5,
          barcode: item.barcode || null,
          isActive: item.isActive ?? true,
        });
      }

      const seen = new Set<string>();
      for (const r of resolved) {
        const key = `${r.branchId}|${r.unitId ?? ""}|${r.variantId ?? ""}`;
        if (seen.has(key)) {
          throw new BadRequestException(
            "Duplikat: kombinasi cabang/satuan/varian tidak boleh sama",
          );
        }
        seen.add(key);
      }

      await tx.productBranchSku.deleteMany({ where: { productId } });
      if (resolved.length > 0) {
        await tx.productBranchSku.createMany({
          data: resolved.map((r) => ({
            productId,
            branchId: r.branchId,
            unitId: r.unitId,
            variantId: r.variantId,
            sellingPrice: r.sellingPrice,
            purchasePrice: r.purchasePrice,
            stock: r.stock,
            minStock: r.minStock,
            barcode: r.barcode,
            isActive: r.isActive,
          })),
        });
      }

      const perBranch = new Map<
        string,
        { sellingPrice: number; purchasePrice: number; stock: number; minStock: number }
      >();
      for (const r of resolved) {
        if (!r.isActive) continue;
        const current = perBranch.get(r.branchId);
        const isBaseCell = !r.unitId;
        if (!current) {
          perBranch.set(r.branchId, {
            sellingPrice: r.sellingPrice,
            purchasePrice: r.purchasePrice,
            stock: isBaseCell ? r.stock : 0,
            minStock: r.minStock,
          });
          continue;
        }
        if (isBaseCell) {
          current.sellingPrice = r.sellingPrice;
          current.purchasePrice = r.purchasePrice;
          current.stock = r.stock;
          current.minStock = r.minStock;
        }
      }

      const branchIdsInPayload = [...perBranch.keys()];
      if (branchIdsInPayload.length > 0) {
        await tx.branchProductPrice.deleteMany({
          where: {
            productId,
            branchId: { notIn: branchIdsInPayload },
          },
        });
        await tx.branchStock.deleteMany({
          where: {
            productId,
            branchId: { notIn: branchIdsInPayload },
          },
        });
      }

      for (const [branchId, vals] of perBranch.entries()) {
        await tx.branchProductPrice.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
          update: {
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
        });
        const aggregateStock = Math.min(vals.stock, INT32_MAX);
        await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            quantity: aggregateStock,
            minStock: vals.minStock,
          },
          update: {
            quantity: aggregateStock,
            minStock: vals.minStock,
          },
        });
      }

      const totalStock = Math.min([...perBranch.values()].reduce(
        (sum, v) => sum + v.stock,
        0,
      ), INT32_MAX);
      const repCell = [...perBranch.values()][0];
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: totalStock,
          ...(repCell
            ? {
                purchasePrice: repCell.purchasePrice,
                sellingPrice: repCell.sellingPrice,
                minStock: repCell.minStock,
              }
            : {}),
        },
      });
    });
  }

  async softDelete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findExists({ id, companyId });
    if (!existing) throw new NotFoundException("Produk tidak ditemukan");

    await this.repo.softDelete(id);
    return { success: true };
  }

  async bulkSoftDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ count: number }> {
    const count = await this.repo.bulkSoftDelete(companyId, ids);
    return { count };
  }

  async stats(
    companyId: string,
    branchId?: string,
  ): Promise<{
    total: number;
    active: number;
    lowStock: number;
    outOfStock: number;
  }> {
    if (branchId) {
      const result = await this.repo.statsByBranch(companyId, branchId);
      const r = result[0];
      return {
        total: Number(r.total),
        active: Number(r.active),
        lowStock: Number(r.lowStock),
        outOfStock: Number(r.outOfStock),
      };
    }
    const result = await this.repo.statsGlobal(companyId);
    const r = result[0];
    return {
      total: Number(r.total),
      active: Number(r.active),
      lowStock: Number(r.lowStock),
      outOfStock: Number(r.outOfStock),
    };
  }

  async generateUniqueProductCode(companyId: string): Promise<string> {
    const company = await this.repo.findCompanySlug(companyId);
    const rawSlug = (company?.slug || "PRD").replace(/[^a-zA-Z0-9]/g, "");
    const slug = (rawSlug || "PRD").toUpperCase().slice(0, 6);
    const prefix = `${slug}-`;

    const rows = await this.repo.findProductCodes(companyId, prefix);
    let maxSeq = 0;
    for (const r of rows) {
      const tail = r.code.slice(prefix.length);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxSeq) maxSeq = n;
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${prefix}${String(maxSeq + 1 + attempt).padStart(4, "0")}`;
      const exists = await this.repo.findExists({ companyId, code: candidate });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      "Gagal generate kode produk unik setelah 100 percobaan",
    );
  }

  async generateUniqueBarcode(
    companyId: string,
    prefix?: string,
  ): Promise<string> {
    const cleanPrefix = (prefix ?? "20").replace(/\D/g, "").slice(0, 3) || "20";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateEan13(cleanPrefix);
      const collision = await this.barcodeExists(companyId, candidate);
      if (!collision) return candidate;
    }
    throw new InternalServerErrorException(
      "Gagal generate barcode unik setelah 10 percobaan",
    );
  }

  private async barcodeExists(
    companyId: string,
    barcode: string,
  ): Promise<boolean> {
    const [product, unit, branchSku] = await Promise.all([
      this.repo.barcodeExistsInProduct(companyId, barcode),
      this.repo.barcodeExistsInUnit(companyId, barcode),
      this.repo.barcodeExistsInBranchSku(companyId, barcode),
    ]);
    return Boolean(product || unit || branchSku);
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

  async topSelling(
    companyId: string,
    limit = 8,
  ): Promise<unknown[]> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const items = await this.repo.topSellingItems(companyId, since, limit);
    if (items.length === 0) return [];
    const products = await this.repo.findProductSummaries(
      companyId,
      items.map((i) => i.productId),
    );
    const map = new Map(products.map((p) => [p.id, p]));
    return items
      .map((it) => {
        const p = map.get(it.productId);
        if (!p) return null;
        return {
          ...p,
          totalQty: it._sum.quantity ?? 0,
          totalRevenue: it._sum.subtotal ?? 0,
        };
      })
      .filter(Boolean);
  }

  async byCategory(
    companyId: string,
    categoryId: string,
  ): Promise<unknown[]> {
    return this.repo.findByCategory(companyId, categoryId);
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

  async importTemplateData(companyId: string): Promise<{
    categories: { id: string; name: string }[];
    brands: { id: string; name: string }[];
    existingCodes: string[];
    branches: { id: string; name: string; code: string | null }[];
    productCount: number;
  }> {
    const [categories, brands, products, branches, productCount] =
      await this.repo.findImportTemplateData(companyId);
    return {
      categories,
      brands,
      existingCodes: products.map((p) => p.code),
      branches,
      productCount,
    };
  }
}

function toProductResponse(p: RawProduct): ProductResponse {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    brandId: p.brandId,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name } : null,
    supplierId: p.supplierId,
    supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
    purchasePrice: p.purchasePrice,
    sellingPrice: p.sellingPrice,
    stock: p.stock,
    minStock: p.minStock,
    barcode: p.barcode,
    unit: p.unit,
    itemType: (p.itemType as ProductResponse["itemType"]) ?? "PRODUCT",
    isActive: p.isActive,
    description: p.description,
    imageUrl: p.imageUrl,
    defaultRackId: p.defaultRackId ?? null,
    defaultRack: p.defaultRack
      ? {
          id: p.defaultRack.id,
          code: p.defaultRack.code,
          name: p.defaultRack.name,
          branchId: p.defaultRack.branchId,
        }
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    unitCount: p._count?.units ?? 0,
    variantCount: p._count?.variants ?? 0,
  };
}

function generateEan13(prefix = "20"): string {
  const targetLen = 12;
  let body = prefix.replace(/\D/g, "").slice(0, 3);
  while (body.length < targetLen) {
    body += Math.floor(Math.random() * 10).toString();
  }
  body = body.slice(0, targetLen);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check.toString();
}
