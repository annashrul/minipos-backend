import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── SELECT constants ─────────────────────────────────────────────────

const SHOPEE_ACCOUNT_LIST_SELECT = {
  id: true,
  shopId: true,
  shopName: true,
  region: true,
  isActive: true,
  expiresAt: true,
  refreshExpiresAt: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
} satisfies Prisma.ShopeeAccountSelect;

export type RawShopeeAccountListItem = Prisma.ShopeeAccountGetPayload<{
  select: typeof SHOPEE_ACCOUNT_LIST_SELECT;
}>;

const SHOPEE_ITEM_LIST_SELECT = {
  id: true,
  itemId: true,
  modelId: true,
  name: true,
  sku: true,
  status: true,
  currentPrice: true,
  totalStock: true,
  imageUrl: true,
  hasModel: true,
  lastFetchedAt: true,
  lastPushedAt: true,
  product: { select: { id: true, name: true, code: true } },
} satisfies Prisma.ShopeeItemSelect;

export type RawShopeeItemListItem = Prisma.ShopeeItemGetPayload<{
  select: typeof SHOPEE_ITEM_LIST_SELECT;
}>;

@Injectable()
export class MarketplaceShopeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── ShopeeAccount ────────────────────────────────────────────────

  async upsertAccountByCookie(
    companyId: string,
    shopId: string,
    create: Prisma.ShopeeAccountUncheckedCreateInput,
    update: Prisma.ShopeeAccountUncheckedUpdateInput,
  ) {
    return this.prisma.shopeeAccount.upsert({
      where: { companyId_shopId: { companyId, shopId } },
      create,
      update,
    });
  }

  async upsertAccountByOAuth(
    companyId: string,
    shopId: string,
    create: Prisma.ShopeeAccountUncheckedCreateInput,
    update: Prisma.ShopeeAccountUncheckedUpdateInput,
  ) {
    return this.prisma.shopeeAccount.upsert({
      where: { companyId_shopId: { companyId, shopId } },
      create,
      update,
    });
  }

  async findManyAccounts(companyId: string): Promise<RawShopeeAccountListItem[]> {
    return this.prisma.shopeeAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: SHOPEE_ACCOUNT_LIST_SELECT,
    });
  }

  async findAccountByIdAndCompany(
    accountId: string,
    companyId: string,
    select?: Prisma.ShopeeAccountSelect,
  ) {
    return this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
      ...(select ? { select } : {}),
    });
  }

  async findAccountById(accountId: string) {
    return this.prisma.shopeeAccount.findUnique({
      where: { id: accountId },
    });
  }

  async deleteAccount(accountId: string) {
    await this.prisma.shopeeAccount.delete({ where: { id: accountId } });
  }

  async updateAccount(
    accountId: string,
    data: Prisma.ShopeeAccountUncheckedUpdateInput,
  ) {
    return this.prisma.shopeeAccount.update({
      where: { id: accountId },
      data,
    });
  }

  // ── ShopeeItem ───────────────────────────────────────────────────

  async findCachedItems(accountId: string): Promise<RawShopeeItemListItem[]> {
    return this.prisma.shopeeItem.findMany({
      where: { shopeeAccountId: accountId },
      orderBy: { lastFetchedAt: "desc" },
      select: SHOPEE_ITEM_LIST_SELECT,
    });
  }

  async findShopeeItemByIdAndCompany(shopeeItemId: string, companyId: string) {
    return this.prisma.shopeeItem.findFirst({
      where: { id: shopeeItemId, account: { companyId } },
      select: { id: true },
    });
  }

  async updateShopeeItem(
    shopeeItemId: string,
    data: Prisma.ShopeeItemUncheckedUpdateInput,
  ) {
    return this.prisma.shopeeItem.update({
      where: { id: shopeeItemId },
      data,
    });
  }

  async findShopeeItemForPush(shopeeItemId: string, companyId: string) {
    return this.prisma.shopeeItem.findFirst({
      where: { id: shopeeItemId, account: { companyId } },
      include: { account: true },
    });
  }

  async findShopeeItemByProduct(productId: string, companyId: string) {
    return this.prisma.shopeeItem.findFirst({
      where: {
        productId,
        account: { companyId, isActive: true },
      },
      select: { id: true },
    });
  }

  async findShopeeItemByProductForLink(productId: string, companyId: string) {
    return this.prisma.shopeeItem.findFirst({
      where: {
        productId,
        account: { companyId, isActive: true },
      },
      select: { id: true, shopeeAccountId: true },
    });
  }

  async findLinkedProductIds(companyId: string) {
    return this.prisma.shopeeItem.findMany({
      where: {
        productId: { not: null },
        account: { companyId, isActive: true },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
  }

  async findExistingShopeeItem(
    accountId: string,
    itemId: string,
    modelId: string,
  ) {
    return this.prisma.shopeeItem.findUnique({
      where: {
        shopeeAccountId_itemId_modelId: {
          shopeeAccountId: accountId,
          itemId,
          modelId,
        },
      },
      select: { productId: true },
    });
  }

  async upsertShopeeItem(
    accountId: string,
    itemId: string,
    modelId: string,
    create: Prisma.ShopeeItemUncheckedCreateInput,
    update: Prisma.ShopeeItemUncheckedUpdateInput,
  ) {
    return this.prisma.shopeeItem.upsert({
      where: {
        shopeeAccountId_itemId_modelId: {
          shopeeAccountId: accountId,
          itemId,
          modelId,
        },
      },
      create,
      update,
    });
  }

  // ── Product ──────────────────────────────────────────────────────

  async findProductByIdAndCompany(
    productId: string,
    companyId: string,
    select?: Prisma.ProductSelect,
  ) {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      ...(select ? { select } : {}),
    });
  }

  async findProductByIdOnly(productId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId },
      select: { id: true, deletedAt: true },
    });
  }

  async updateProduct(productId: string, data: Prisma.ProductUpdateInput) {
    return this.prisma.product.update({
      where: { id: productId },
      data,
    });
  }

  async updateProductUnitPrice(productId: string, sellingPrice: number) {
    return this.prisma.productUnit.updateMany({
      where: { productId, isDefault: true },
      data: { sellingPrice },
    });
  }

  async findProductByCode(companyId: string, code: string) {
    return this.prisma.product.findFirst({
      where: {
        companyId,
        OR: [{ code }, { barcode: code }],
      },
      select: { id: true },
    });
  }

  // Cari produk berdasarkan kode TERMASUK yang soft-deleted. Wajib raw SQL —
  // PrismaService proxy meng-inject `deletedAt: null` pada query model biasa,
  // jadi findFirst TIDAK melihat produk yang sudah dihapus. Padahal unique
  // constraint (companyId, code) tetap mencakup baris soft-deleted, sehingga
  // create bisa gagal walau findFirst bilang "tidak ada". Raw SQL bypass proxy.
  async findProductByCodeAnyState(companyId: string, code: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; deletedAt: Date | null }>
    >`
      SELECT id, "deletedAt" FROM "products"
      WHERE "companyId" = ${companyId} AND code = ${code}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async createProduct(data: Prisma.ProductUncheckedCreateInput & {
    units?: { create: Prisma.ProductUnitUncheckedCreateWithoutProductInput };
  }) {
    return this.prisma.product.create({
      data,
      select: { id: true },
    });
  }

  async reviveProduct(productId: string) {
    return this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: null, isActive: true },
    });
  }

  // ── Branch ───────────────────────────────────────────────────────

  async findActiveBranches(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });
  }

  // Samakan stok ke SEMUA row branch_stocks produk (stok Shopee shop-wide).
  // Mencakup cabang non-aktif yang sudah punya row — supaya vw_product_branch
  // (COALESCE(bs.quantity, p.stock)) tidak menampilkan qty lama.
  async updateAllBranchStocksForProduct(productId: string, quantity: number) {
    return this.prisma.branchStock.updateMany({
      where: { productId },
      data: { quantity },
    });
  }

  // Update stok base SKU (unit & varian null) di product_branch_skus — sumber
  // stok yang dibaca sebagian query list produk/POS. Tanpa ini, Shopee sync
  // tidak mengubah angka yang tampil walau branch_stocks sudah benar.
  async updateProductBranchSkuStock(productId: string, stock: number) {
    return this.prisma.productBranchSku.updateMany({
      where: { productId, unitId: null, variantId: null },
      data: { stock },
    });
  }

  async findBranchByIdAndCompany(branchId: string, companyId: string) {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId, isActive: true },
      select: { id: true },
    });
  }

  // ── BranchProductPrice ───────────────────────────────────────────

  async upsertBranchProductPrice(
    branchId: string,
    productId: string,
    sellingPrice: number,
    purchasePrice: number,
  ) {
    return this.prisma.branchProductPrice.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, sellingPrice, purchasePrice },
      update: { sellingPrice },
    });
  }

  async createManyBranchProductPrices(
    data: Prisma.BranchProductPriceCreateManyInput[],
  ) {
    return this.prisma.branchProductPrice.createMany({
      data,
      skipDuplicates: true,
    });
  }

  // ── BranchStock ──────────────────────────────────────────────────

  async upsertBranchStock(
    branchId: string,
    productId: string,
    quantity: number,
    minStock: number,
  ) {
    return this.prisma.branchStock.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity, minStock },
      update: { quantity },
    });
  }

  async findBranchStock(branchId: string, productId: string) {
    return this.prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { quantity: true },
    });
  }

  async createManyBranchStocks(
    data: Prisma.BranchStockCreateManyInput[],
  ) {
    return this.prisma.branchStock.createMany({
      data,
      skipDuplicates: true,
    });
  }

  // ── Category ─────────────────────────────────────────────────────

  async findShopeeImportCategory(companyId: string) {
    return this.prisma.category.findFirst({
      where: { companyId, name: "Shopee Import", kind: "PRODUCT" },
      select: { id: true },
    });
  }

  async createShopeeImportCategory(companyId: string) {
    return this.prisma.category.create({
      data: {
        companyId,
        name: "Shopee Import",
        kind: "PRODUCT",
        description: "Produk auto-imported dari Shopee. Edit jika perlu.",
      },
      select: { id: true },
    });
  }

  // ── ProductMarketplaceMapping ────────────────────────────────────

  async findMappingForPush(mappingId: string, companyId: string) {
    return this.prisma.productMarketplaceMapping.findFirst({
      where: {
        id: mappingId,
        marketplace: "SHOPEE",
        shopeeAccount: { companyId },
      },
      include: { shopeeAccount: true },
    });
  }

  async updateMapping(
    mappingId: string,
    data: Prisma.ProductMarketplaceMappingUncheckedUpdateInput,
  ) {
    return this.prisma.productMarketplaceMapping.update({
      where: { id: mappingId },
      data,
    });
  }

  async findMappingByExternal(externalItemId: string, externalModelId: string) {
    return this.prisma.productMarketplaceMapping.findFirst({
      where: {
        marketplace: "SHOPEE",
        externalItemId,
        externalModelId,
      },
      select: { id: true },
    });
  }

  async createMapping(data: Prisma.ProductMarketplaceMappingUncheckedCreateInput) {
    return this.prisma.productMarketplaceMapping.create({ data });
  }

  async findMappingByIdAndCompany(mappingId: string, companyId: string) {
    return this.prisma.productMarketplaceMapping.findFirst({
      where: {
        id: mappingId,
        shopeeAccount: { companyId },
      },
      select: { id: true },
    });
  }

  async deleteMapping(mappingId: string) {
    await this.prisma.productMarketplaceMapping.delete({
      where: { id: mappingId },
    });
  }

  async findManyMappings(accountId: string, companyId: string) {
    return this.prisma.productMarketplaceMapping.findMany({
      where: {
        marketplace: "SHOPEE",
        shopeeAccountId: accountId,
        shopeeAccount: { companyId },
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
