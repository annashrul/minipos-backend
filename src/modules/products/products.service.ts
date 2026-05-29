import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
import { ProductCreateUpdateService } from "./product-create-update.service";
import { ProductSearchService } from "./product-search.service";
import { toProductResponse, generateEan13 } from "./products.helpers";

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly prisma: PrismaService,
    private readonly createUpdate: ProductCreateUpdateService,
    private readonly search: ProductSearchService,
  ) {}

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

  async create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    return this.createUpdate.create(companyId, dto);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.createUpdate.update(companyId, id, dto);
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
    menuCount: number;
    ingredientCount: number;
    serviceCount: number;
  }> {
    const result = branchId
      ? await this.repo.statsByBranch(companyId, branchId)
      : await this.repo.statsGlobal(companyId);
    const r = result[0];
    return {
      total: Number(r.total),
      active: Number(r.active),
      lowStock: Number(r.lowStock),
      outOfStock: Number(r.outOfStock),
      menuCount: Number(r.menuCount),
      ingredientCount: Number(r.ingredientCount),
      serviceCount: Number(r.serviceCount),
    };
  }

  // ── Auto-suggest produk yang perlu di-PO (stok <= minStock) ──
  // Hitung suggestedQty di service: bring stock back to 2× minStock.
  // Unit price default ambil dari lastPurchasePrice (kalau ada) atau
  // product.purchasePrice. Frontend tinggal pakai langsung tanpa logic tambahan.
  async getPoSuggestions(companyId: string, branchId?: string) {
    const rows = await this.repo.findPoSuggestions(companyId, branchId);
    return rows.map((r) => {
      const suggestedQty = Math.max(r.minStock * 2 - r.currentStock, 1);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        unit: r.unit,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        currentStock: r.currentStock,
        minStock: r.minStock,
        suggestedQty,
        unitPrice: r.lastPurchasePrice ?? r.purchasePrice,
      };
    });
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
    return this.search.findByBarcode(companyId, barcode, branchId);
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
    return this.search.posSearch(companyId, params);
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
    return this.search.branchView(companyId, params);
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

export { toProductResponse, generateEan13 } from "./products.helpers";
