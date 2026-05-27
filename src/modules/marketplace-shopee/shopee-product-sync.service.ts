import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ShopeeApiService,
  type ShopeeItemBaseInfo,
} from "./shopee-api.service";
import { ShopeeScraperService } from "./shopee-scraper.service";
import { MarketplaceShopeeRepository } from "./marketplace-shopee.repository";

/**
 * Handles Shopee product sync: fetch from Shopee, auto-create/match/revive
 * MiniPOS products, and persist ShopeeItem cache rows.
 */
@Injectable()
export class ShopeeProductSyncService {
  private readonly logger = new Logger(ShopeeProductSyncService.name);

  constructor(
    private readonly repo: MarketplaceShopeeRepository,
    private readonly shopeeApi: ShopeeApiService,
    private readonly scraper: ShopeeScraperService,
  ) {}

  /**
   * Apply Shopee data ke Product yang sudah ada (link existing / revive /
   * auto-match). Field yang di-overwrite: name, sellingPrice, stock,
   * imageUrl, plus default ProductUnit + BranchStock + BranchProductPrice
   * untuk semua cabang aktif.
   *
   * Field yang DI-PRESERVE (tidak diganggu, supaya edit manual user tidak
   * hilang saat re-sync): code, purchasePrice, categoryId, brandId,
   * supplierId, description, itemType, isActive.
   */
  private async applyShopeeDataToProduct(params: {
    companyId: string;
    productId: string;
    name: string;
    sellingPrice: number;
    stock: number;
    imageUrl: string | null;
  }): Promise<void> {
    const { companyId, productId, name, sellingPrice, stock, imageUrl } =
      params;
    await this.repo.updateProduct(productId, {
      name: name.slice(0, 200),
      sellingPrice,
      stock,
      imageUrl,
    });
    // Update default ProductUnit (kalau ada) — biar form edit nampilin harga
    // baru. Pakai updateMany supaya tidak error kalau belum ada default unit.
    await this.repo.updateProductUnitPrice(productId, sellingPrice);
    // Update / create per-branch price + stock untuk semua cabang aktif.
    const branches = await this.repo.findActiveBranches(companyId);
    for (const b of branches) {
      await this.repo.upsertBranchProductPrice(b.id, productId, sellingPrice, 0);
      await this.repo.upsertBranchStock(b.id, productId, stock, 5);
    }
  }

  /**
   * Cari atau buat kategori "Shopee Import" untuk company. Dipakai sebagai
   * default categoryId saat auto-create Product dari Shopee item.
   */
  private async ensureShopeeImportCategory(
    companyId: string,
  ): Promise<string> {
    const existing = await this.repo.findShopeeImportCategory(companyId);
    if (existing) return existing.id;
    const created = await this.repo.createShopeeImportCategory(companyId);
    return created.id;
  }

  /**
   * Fetch SEMUA produk di shop (paginated loop). Return list dengan field
   * yang UI butuh: name, image, price, stock, status, sku.
   */
  async fetchProducts(
    companyId: string,
    accountId: string,
    getValidAccessToken: (accountId: string) => Promise<{
      accessToken: string;
      shopId: string;
    }>,
  ): Promise<{
    items: Array<{
      itemId: number;
      name: string;
      sku: string | null;
      status: string;
      currentPrice: number | null;
      originalPrice: number | null;
      currency: string | null;
      totalStock: number | null;
      imageUrl: string | null;
      hasModel: boolean;
      updateTime: string | null;
      models: Array<{ id: number; name: string | null; sku: string | null; stock: number | null }>;
    }>;
    totalCount: number;
    createdProductCount?: number;
    matchedProductCount?: number;
    preservedLinkCount?: number;
    revivedProductCount?: number;
  }> {
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId);
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");

    // COOKIE mode: pakai scraper dengan cookie session.
    if (account.connectionMode === "COOKIE") {
      if (!account.sellerCookie) {
        throw new BadRequestException(
          "Cookie session belum di-set. Re-connect Shopee dulu.",
        );
      }
      try {
        const result = await this.scraper.fetchAllProducts(
          account.sellerCookie,
          account.cookieUserAgent,
        );
        // Persist to ShopeeItem table — 1 row per (itemId, modelId).
        // - Auto-match by SKU: kalau Shopee sku match Product.code/barcode,
        //   link ke product existing.
        // - Auto-create Product: kalau gak match, bikin Product baru di
        //   kategori "Shopee Import" supaya muncul di master data MiniPOS.
        // - Saat re-fetch, productId di ShopeeItem TIDAK di-overwrite —
        //   user manual link tetap dipertahankan.
        const now = new Date();
        const importCategoryId = await this.ensureShopeeImportCategory(
          companyId,
        );
        let createdProductCount = 0;
        let matchedProductCount = 0;
        let preservedLinkCount = 0;
        let revivedProductCount = 0;
        for (const item of result.items) {
          const itemIdStr = String(item.itemId);
          const modelRows = item.models.length > 0
            ? item.models
            : [{ id: 0, name: null, sku: null, stock: item.totalStock ?? null }];
          for (const m of modelRows) {
            const modelIdStr = m.id > 0 ? String(m.id) : "0";
            const skuForMatch = m.sku || item.sku || null;
            // Cari produk MiniPOS dengan SKU yang sama (untuk auto-link)
            let autoMatchProductId: string | null = null;
            if (skuForMatch) {
              const matched = await this.repo.findProductByCode(companyId, skuForMatch);
              autoMatchProductId = matched?.id ?? null;
            }

            // Auto-create Product kalau belum match — supaya produk Shopee
            // muncul di master data MiniPOS. Skip kalau ShopeeItem ini sudah
            // pernah punya productId YANG MASIH HIDUP (preserve manual link).
            const existingItem = await this.repo.findExistingShopeeItem(accountId, itemIdStr, modelIdStr);
            // Validasi: linked product masih ada & belum di-soft-delete.
            // Kalau user pernah delete produk yg di-link Shopee:
            //   - REVIVE soft-deleted product (clear deletedAt + isActive=true)
            //     supaya muncul lagi di list MiniPOS tanpa duplikat.
            //   - Preserve link (productId di ShopeeItem tetap valid).
            let linkedAlive = false;
            if (existingItem?.productId) {
              const linked = await this.repo.findProductByIdOnly(existingItem.productId);
              if (linked) {
                if (linked.deletedAt) {
                  // Revive: clear soft-delete & re-activate.
                  await this.repo.reviveProduct(linked.id);
                  revivedProductCount++;
                }
                linkedAlive = true;
              }
              // linked == null shouldn't happen (FK exists), but kalau hard
              // deleted by some other path, linkedAlive=false → fall through
              // to auto-create.
            }
            if (linkedAlive && existingItem?.productId) {
              autoMatchProductId = existingItem.productId;
              preservedLinkCount++;
            } else if (autoMatchProductId) {
              matchedProductCount++;
            }
            // Apply latest Shopee data (name/price/stock/image) ke Product
            // existing — supaya selalu sinkron dengan Shopee. Skip untuk
            // auto-create branch (data sudah fresh saat create).
            if (autoMatchProductId) {
              await this.applyShopeeDataToProduct({
                companyId,
                productId: autoMatchProductId,
                name: item.name + (m.name ? ` - ${m.name}` : ""),
                sellingPrice: item.currentPrice ?? 0,
                stock: m.stock ?? item.totalStock ?? 0,
                imageUrl: item.imageUrl,
              });
            }
            if (!autoMatchProductId) {
              const productName =
                item.name + (m.name ? ` - ${m.name}` : "");
              const productCode =
                skuForMatch || `SHOPEE-${itemIdStr}-${modelIdStr}`;
              // Code wajib unique per company. Kalau collision (rare),
              // tambah suffix random.
              const codeCollision = await this.repo.findProductCodeCollision(companyId, productCode);
              const finalCode = codeCollision
                ? `${productCode}-${Math.random().toString(36).slice(2, 6)}`
                : productCode;
              const sellingPriceVal = item.currentPrice ?? 0;
              const stockVal = m.stock ?? item.totalStock ?? 0;
              const newProduct = await this.repo.createProduct({
                companyId,
                categoryId: importCategoryId,
                code: finalCode,
                name: productName.slice(0, 200),
                purchasePrice: 0,
                sellingPrice: sellingPriceVal,
                stock: stockVal,
                imageUrl: item.imageUrl,
                itemType: "PRODUCT",
                isActive: true,
                // Default unit wajib supaya form edit UI bisa nampilkan
                // harga (UI baca dari product_units, bukan Product.sellingPrice).
                units: {
                  create: {
                    name: "pcs",
                    conversionQty: 1,
                    sellingPrice: sellingPriceVal,
                    purchasePrice: 0,
                    isDefault: true,
                    sortOrder: 0,
                  },
                },
              });
              autoMatchProductId = newProduct.id;
              createdProductCount++;

              // Populate per-branch price + stock supaya tab "Harga & Stok"
              // di product edit form tidak kosong. Skip kalau company belum
              // punya branch (rare edge case).
              const branches = await this.repo.findActiveBranches(companyId);
              if (branches.length > 0) {
                await this.repo.createManyBranchProductPrices(
                  branches.map((b) => ({
                    branchId: b.id,
                    productId: newProduct.id,
                    sellingPrice: sellingPriceVal,
                    purchasePrice: 0,
                  })),
                );
                await this.repo.createManyBranchStocks(
                  branches.map((b) => ({
                    branchId: b.id,
                    productId: newProduct.id,
                    quantity: stockVal,
                    minStock: 5,
                  })),
                );
              }
            }
            await this.repo.upsertShopeeItem(
              accountId,
              itemIdStr,
              modelIdStr,
              {
                shopeeAccountId: accountId,
                itemId: itemIdStr,
                modelId: modelIdStr,
                name: item.name + (m.name ? ` - ${m.name}` : ""),
                sku: m.sku || item.sku || null,
                status: item.status,
                currentPrice: item.currentPrice,
                originalPrice: item.originalPrice,
                totalStock: m.stock ?? item.totalStock,
                imageUrl: item.imageUrl,
                hasModel: item.hasModel,
                productId: autoMatchProductId,
                lastFetchedAt: now,
              },
              {
                // Update data Shopee. productId hanya di-set kalau existing
                // belum punya — preserve manual link / auto-link sebelumnya.
                name: item.name + (m.name ? ` - ${m.name}` : ""),
                sku: m.sku || item.sku || null,
                status: item.status,
                currentPrice: item.currentPrice,
                originalPrice: item.originalPrice,
                totalStock: m.stock ?? item.totalStock,
                imageUrl: item.imageUrl,
                hasModel: item.hasModel,
                lastFetchedAt: now,
                // Set productId di update branch hanya kalau:
                //  - belum ada productId di existing, ATAU
                //  - existing productId stale (linked product sudah deleted).
                // Kalau link valid (linkedAlive), jangan ganggu — preserve.
                productId: linkedAlive
                  ? undefined
                  : autoMatchProductId,
              },
            );
          }
        }
        await this.repo.updateAccount(accountId, { lastSyncedAt: now, lastError: null });
        this.logger.log(
          `[shopee fetch] account=${accountId} shopee_items=${result.items.length} ` +
            `created=${createdProductCount} matched=${matchedProductCount} ` +
            `preserved=${preservedLinkCount} revived=${revivedProductCount}`,
        );
        return {
          ...result,
          createdProductCount,
          matchedProductCount,
          preservedLinkCount,
          revivedProductCount,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        await this.repo.updateAccount(accountId, { lastError: msg });
        throw err;
      }
    }

    // OAUTH mode (default): pakai official API.
    if (!account.accessToken) {
      throw new BadRequestException(
        "Akun OAuth tidak punya access_token. Re-authorize Shopee.",
      );
    }
    const { accessToken, shopId } = await getValidAccessToken(accountId);

    // Loop get_item_list sampai has_next_page false.
    const allItemIds: number[] = [];
    let offset = 0;
    let totalCount = 0;
    while (true) {
      const page = await this.shopeeApi.getItemList(
        accessToken,
        shopId,
        offset,
        50,
      );
      totalCount = page.totalCount;
      for (const it of page.items) allItemIds.push(it.item_id);
      if (!page.hasNextPage || page.items.length === 0) break;
      offset = page.nextOffset;
      if (allItemIds.length >= 1000) break; // safety cap
    }

    // Chunk item_id list ke 50-an, panggil get_item_base_info per chunk.
    const allItems: ShopeeItemBaseInfo[] = [];
    for (let i = 0; i < allItemIds.length; i += 50) {
      const chunk = allItemIds.slice(i, i + 50);
      const details = await this.shopeeApi.getItemBaseInfo(
        accessToken,
        shopId,
        chunk,
      );
      allItems.push(...details);
    }

    // Update last_synced_at
    await this.repo.updateAccount(accountId, { lastSyncedAt: new Date(), lastError: null });

    return {
      totalCount,
      items: allItems.map((it) => {
        const priceInfo = it.price_info?.[0];
        return {
          itemId: it.item_id,
          name: it.item_name,
          sku: it.item_sku ?? null,
          status: it.item_status,
          currentPrice: priceInfo?.current_price ?? null,
          originalPrice: priceInfo?.original_price ?? null,
          currency: priceInfo?.currency ?? null,
          totalStock:
            it.stock_info_v2?.summary_info?.total_available_stock ?? null,
          imageUrl: it.image?.image_url_list?.[0] ?? null,
          hasModel: it.has_model,
          updateTime: it.update_time
            ? new Date(it.update_time * 1000).toISOString()
            : null,
          models: [], // OAuth path: model_id butuh call get_model_list terpisah; skip MVP
        };
      }),
    };
  }
}
