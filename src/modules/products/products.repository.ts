import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const PRODUCT_SELECT = {
  id: true,
  code: true,
  name: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  brandId: true,
  brand: { select: { id: true, name: true } },
  supplierId: true,
  supplier: { select: { id: true, name: true } },
  purchasePrice: true,
  sellingPrice: true,
  stock: true,
  minStock: true,
  barcode: true,
  unit: true,
  itemType: true,
  isActive: true,
  description: true,
  imageUrl: true,
  defaultRackId: true,
  defaultRack: { select: { id: true, code: true, name: true, branchId: true } },
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      units: true,
      variants: true,
    },
  },
} satisfies Prisma.ProductSelect;

export type RawProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── List / pagination ──

  async findMany(
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawProduct[]> {
    return this.prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.ProductWhereInput): Promise<number> {
    return this.prisma.product.count({ where });
  }

  // ── Single lookups ──

  async findOne(where: Prisma.ProductWhereInput): Promise<RawProduct | null> {
    return this.prisma.product.findFirst({
      where,
      select: PRODUCT_SELECT,
    });
  }

  async findExists(where: Prisma.ProductWhereInput): Promise<{ id: string } | null> {
    return this.prisma.product.findFirst({
      where,
      select: { id: true },
    });
  }

  // ── Create / Update / Delete ──

  async create(data: Prisma.ProductUncheckedCreateInput): Promise<RawProduct> {
    return this.prisma.product.create({
      data,
      select: PRODUCT_SELECT,
    });
  }

  async update(id: string, data: Prisma.ProductUpdateInput): Promise<RawProduct> {
    return this.prisma.product.update({
      where: { id },
      data,
      select: PRODUCT_SELECT,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async bulkSoftDelete(companyId: string, ids: string[]): Promise<number> {
    const { count } = await this.prisma.product.updateMany({
      where: { id: { in: ids }, companyId },
      data: { deletedAt: new Date(), isActive: false },
    });
    return count;
  }

  // ── Detail sub-resources (findDetail helper queries) ──

  async findProductUnits(productId: string) {
    return this.prisma.productUnit.findMany({
      where: { productId },
      orderBy: [{ sortOrder: "asc" }, { conversionQty: "asc" }],
      select: {
        id: true,
        name: true,
        conversionQty: true,
        sellingPrice: true,
        purchasePrice: true,
        barcode: true,
        isDefault: true,
        sortOrder: true,
      },
    });
  }

  async findBranchSkus(productId: string, branchId?: string) {
    return this.prisma.productBranchSku.findMany({
      where: {
        productId,
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        branchId: true,
        unitId: true,
        variantId: true,
        sellingPrice: true,
        purchasePrice: true,
        stock: true,
        minStock: true,
        barcode: true,
        isActive: true,
      },
    });
  }

  async findTierPrices(productId: string) {
    return this.prisma.productTierPrice.findMany({
      where: { productId },
      orderBy: { minQty: "asc" },
      select: { id: true, minQty: true, price: true },
    });
  }

  async findVariants(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      include: {
        options: {
          select: {
            optionId: true,
            option: { select: { name: true } },
          },
        },
      },
    });
  }

  async findModifierGroups(productId: string) {
    return this.prisma.productModifierGroup.findMany({
      where: { productId },
      select: { modifierGroupId: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async findBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
  }

  // ── Legacy fallback queries (findDetail) ──

  async findLegacyPrices(productId: string, branchId?: string) {
    return this.prisma.branchProductPrice.findMany({
      where: { productId, ...(branchId ? { branchId } : {}) },
      select: { branchId: true, sellingPrice: true, purchasePrice: true },
    });
  }

  async findLegacyStocks(productId: string, branchId?: string) {
    return this.prisma.branchStock.findMany({
      where: { productId, ...(branchId ? { branchId } : {}) },
      select: { branchId: true, quantity: true, minStock: true },
    });
  }

  // ── Modifier group ownership check ──

  async findOwnedModifierGroups(companyId: string, ids: string[]) {
    return this.prisma.modifierGroup.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true },
    });
  }

  // ── Code / barcode generation helpers ──

  async findCompanySlug(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true },
    });
  }

  async findProductCodes(companyId: string, prefix: string) {
    return this.prisma.product.findMany({
      where: { companyId, code: { startsWith: prefix } },
      select: { code: true },
    });
  }

  async barcodeExistsInProduct(companyId: string, barcode: string) {
    return this.prisma.product.findFirst({
      where: { companyId, barcode },
      select: { id: true },
    });
  }

  async barcodeExistsInUnit(companyId: string, barcode: string) {
    return this.prisma.productUnit.findFirst({
      where: { barcode, product: { companyId } },
      select: { id: true },
    });
  }

  async barcodeExistsInBranchSku(companyId: string, barcode: string) {
    return this.prisma.productBranchSku.findFirst({
      where: { barcode, product: { companyId } },
      select: { id: true },
    });
  }

  // ── Barcode search ──

  async findByBarcodeOrCode(companyId: string, barcode: string) {
    return this.prisma.product.findFirst({
      where: {
        companyId,
        OR: [
          { code: barcode },
          { units: { some: { barcode } } },
        ],
      },
      include: {
        category: { select: { name: true } },
        units: true,
      },
    });
  }

  async findBranchStock(productId: string, branchId: string) {
    return this.prisma.branchStock.findFirst({
      where: { productId, branchId },
      select: { quantity: true },
    });
  }

  // ── Recipe stock computation helpers ──

  async findRecipes(companyId: string, productIds: string[]) {
    return this.prisma.recipe.findMany({
      where: {
        productId: { in: productIds },
        product: { companyId, isActive: true },
      },
      select: {
        productId: true,
        yieldQty: true,
        ingredients: {
          select: {
            ingredientId: true,
            quantity: true,
            ingredient: { select: { stock: true } },
          },
        },
      },
    });
  }

  async findBranchStocks(branchId: string, companyId: string, productIds: string[]) {
    return this.prisma.branchStock.findMany({
      where: {
        branchId,
        productId: { in: productIds },
        branch: { companyId },
      },
      select: { productId: true, quantity: true },
    });
  }

  // ── Top selling ──

  async topSellingItems(companyId: string, since: Date, limit: number) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: {
          status: "COMPLETED",
          createdAt: { gte: since },
          user: { companyId },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
  }

  async findProductSummaries(companyId: string, ids: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
    });
  }

  // ── By category ──

  async findByCategory(companyId: string, categoryId: string) {
    return this.prisma.product.findMany({
      where: {
        companyId,
        categoryId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  // ── POS search helpers ──

  async findUnitsByProducts(productIds: string[]) {
    return this.prisma.productUnit.findMany({
      where: { productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        name: true,
        conversionQty: true,
        sellingPrice: true,
        purchasePrice: true,
        barcode: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { conversionQty: "asc" }],
    });
  }

  async findActiveBranchSkus(branchId: string, productIds: string[]) {
    return this.prisma.productBranchSku.findMany({
      where: {
        branchId,
        productId: { in: productIds },
        isActive: true,
      },
      select: {
        productId: true,
        unitId: true,
        variantId: true,
        sellingPrice: true,
        purchasePrice: true,
      },
    });
  }

  // ── Raw SQL: branchView ──

  async branchViewCount(query: string, values: unknown[]): Promise<number> {
    const result = await this.prisma.$queryRawUnsafe<[{ total: number | bigint }]>(
      query,
      ...values,
    );
    return Number(result[0]?.total ?? 0);
  }

  async branchViewData(query: string, values: unknown[]): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(query, ...values);
  }

  async findProductsWithRack(companyId: string, productIds: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: {
        id: true,
        defaultRack: {
          select: {
            id: true,
            code: true,
            name: true,
            branchId: true,
          },
        },
      },
    });
  }

  // ── Raw SQL: stats ──

  async statsByBranch(companyId: string, branchId: string) {
    return this.prisma.$queryRaw<
      [{
        total: bigint;
        active: bigint;
        lowStock: bigint;
        outOfStock: bigint;
        menuCount: bigint;
        ingredientCount: bigint;
        serviceCount: bigint;
      }]
    >`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE p."isActive" = true)::int AS active,
             COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) > 0 AND COALESCE(bs.quantity, 0) <= 10)::int AS "lowStock",
             COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) = 0)::int AS "outOfStock",
             COUNT(*) FILTER (WHERE p."itemType" = 'PRODUCT')::int AS "menuCount",
             COUNT(*) FILTER (WHERE p."itemType" = 'INGREDIENT')::int AS "ingredientCount",
             COUNT(*) FILTER (WHERE p."itemType" = 'SERVICE')::int AS "serviceCount"
        FROM products p
        LEFT JOIN branch_stocks bs ON bs."productId" = p.id AND bs."branchId" = ${branchId}
        WHERE p."companyId" = ${companyId} AND p."deletedAt" IS NULL
    `;
  }

  async statsGlobal(companyId: string) {
    return this.prisma.$queryRaw<
      [{
        total: bigint;
        active: bigint;
        lowStock: bigint;
        outOfStock: bigint;
        menuCount: bigint;
        ingredientCount: bigint;
        serviceCount: bigint;
      }]
    >`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "isActive" = true)::int AS active,
             COUNT(*) FILTER (WHERE stock > 0 AND stock <= 10)::int AS "lowStock",
             COUNT(*) FILTER (WHERE stock = 0)::int AS "outOfStock",
             COUNT(*) FILTER (WHERE "itemType" = 'PRODUCT')::int AS "menuCount",
             COUNT(*) FILTER (WHERE "itemType" = 'INGREDIENT')::int AS "ingredientCount",
             COUNT(*) FILTER (WHERE "itemType" = 'SERVICE')::int AS "serviceCount"
        FROM products
        WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
    `;
  }

  // ── PO suggestions: produk yang stoknya <= minStock ──
  // Logic:
  //   - Pakai branch stock kalau branchId di-pass, kalau tidak pakai product.stock global
  //   - Exclude SERVICE (PO untuk jasa tidak relevan)
  //   - Exclude PRODUCT yang punya Recipe (stoknya derived dari ingredient)
  //   - lastPurchasePrice: ambil dari PurchaseOrderItem terakhir (kalau ada)
  //   - Order by gap (minStock - currentStock) DESC supaya yang paling kritis di atas
  async findPoSuggestions(companyId: string, branchId?: string) {
    if (branchId) {
      return this.prisma.$queryRaw<
        Array<{
          id: string;
          code: string;
          name: string;
          supplierId: string | null;
          supplierName: string | null;
          currentStock: number;
          minStock: number;
          purchasePrice: number;
          lastPurchasePrice: number | null;
          unit: string;
        }>
      >`
        SELECT p.id,
               p.code,
               p.name,
               p."supplierId",
               s.name AS "supplierName",
               COALESCE(bs.quantity, 0)::int AS "currentStock",
               p."minStock"::int AS "minStock",
               p."purchasePrice"::float8 AS "purchasePrice",
               (
                 SELECT poi."unitPrice"::float8
                   FROM purchase_order_items poi
                   JOIN purchase_orders po ON po.id = poi."purchaseOrderId"
                  WHERE poi."productId" = p.id AND po."companyId" = ${companyId}
                  ORDER BY po."createdAt" DESC
                  LIMIT 1
               ) AS "lastPurchasePrice",
               p.unit
          FROM products p
          LEFT JOIN branch_stocks bs ON bs."productId" = p.id AND bs."branchId" = ${branchId}
          LEFT JOIN suppliers s ON s.id = p."supplierId"
         WHERE p."companyId" = ${companyId}
           AND p."deletedAt" IS NULL
           AND p."isActive" = true
           AND p."itemType" IN ('PRODUCT', 'INGREDIENT')
           AND p."minStock" > 0
           AND COALESCE(bs.quantity, 0) <= p."minStock"
           AND p.id NOT IN (SELECT "productId" FROM recipes)
         ORDER BY (p."minStock" - COALESCE(bs.quantity, 0)) DESC, p.name ASC
         LIMIT 100
      `;
    }
    return this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        supplierId: string | null;
        supplierName: string | null;
        currentStock: number;
        minStock: number;
        purchasePrice: number;
        lastPurchasePrice: number | null;
        unit: string;
      }>
    >`
      SELECT p.id,
             p.code,
             p.name,
             p."supplierId",
             s.name AS "supplierName",
             p.stock::int AS "currentStock",
             p."minStock"::int AS "minStock",
             p."purchasePrice"::float8 AS "purchasePrice",
             (
               SELECT poi."unitPrice"::float8
                 FROM purchase_order_items poi
                 JOIN purchase_orders po ON po.id = poi."purchaseOrderId"
                WHERE poi."productId" = p.id AND po."companyId" = ${companyId}
                ORDER BY po."createdAt" DESC
                LIMIT 1
             ) AS "lastPurchasePrice",
             p.unit
        FROM products p
        LEFT JOIN suppliers s ON s.id = p."supplierId"
       WHERE p."companyId" = ${companyId}
         AND p."deletedAt" IS NULL
         AND p."isActive" = true
         AND p."itemType" IN ('PRODUCT', 'INGREDIENT')
         AND p."minStock" > 0
         AND p.stock <= p."minStock"
         AND p.id NOT IN (SELECT "productId" FROM recipes)
       ORDER BY (p."minStock" - p.stock) DESC, p.name ASC
       LIMIT 100
    `;
  }

  // ── Import template data ──

  async findImportTemplateData(companyId: string) {
    return Promise.all([
      this.prisma.category.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.brand.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.product.findMany({
        where: { companyId },
        select: { code: true },
      }),
      this.prisma.branch.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.product.count({ where: { companyId } }),
    ]);
  }
}
