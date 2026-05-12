import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  ShopeeApiService,
  type ShopeeItemBaseInfo,
} from "./shopee-api.service";
import {
  ShopeeScraperService,
  type ScrapingTokens,
} from "./shopee-scraper.service";
import { ShopeePlaywrightService } from "./shopee-playwright.service";

/**
 * Orchestration layer untuk Shopee integration. Handle:
 * - Token storage (CRUD ShopeeAccount)
 * - Auto-refresh access_token kalau mau expire
 * - Wrap call ke ShopeeApiService dengan token aktif
 */
@Injectable()
export class MarketplaceShopeeService {
  private readonly logger = new Logger(MarketplaceShopeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopeeApi: ShopeeApiService,
    private readonly scraper: ShopeeScraperService,
    private readonly playwright: ShopeePlaywrightService,
  ) {}

  /**
   * Connect Shopee via Playwright. Backend buka Chromium di mesin yang
   * jalankan backend (= laptop user kalau backend lokal). User login
   * manual di window itu. Setelah sukses login, cookies di-capture &
   * disimpan, browser auto-close.
   *
   * KEEP IN MIND: hanya jalan kalau backend running lokal di laptop user.
   * Kalau backend di Cloud Run, Chromium akan launch di server (headless,
   * tidak terlihat oleh user) — login tidak akan jalan.
   */
  async connectViaPlaywright(
    companyId: string,
  ): Promise<{ accountId: string; shopId: string }> {
    const { cookieString, userAgent } =
      await this.playwright.openLoginAndCaptureCookies();
    return this.connectViaCookie(companyId, cookieString, userAgent);
  }

  /**
   * Connect via paste cookie session (PoC mode). User dapat cookie dari
   * DevTools browser → paste ke form. Backend verify cookie valid, lalu
   * save ke ShopeeAccount dengan connectionMode=COOKIE.
   */
  async connectViaCookie(
    companyId: string,
    cookie: string,
    userAgent: string | null,
  ): Promise<{ accountId: string; shopId: string }> {
    if (!cookie.trim()) throw new BadRequestException("Cookie kosong");
    const cleaned = cookie.trim();
    const info = await this.scraper.verifyCookie(cleaned, userAgent);

    const account = await this.prisma.shopeeAccount.upsert({
      where: {
        companyId_shopId: { companyId, shopId: info.shopId },
      },
      create: {
        companyId,
        shopId: info.shopId,
        shopName: info.shopName,
        connectionMode: "COOKIE",
        sellerCookie: cleaned,
        cookieUserAgent: userAgent,
        isActive: true,
      },
      update: {
        connectionMode: "COOKIE",
        sellerCookie: cleaned,
        cookieUserAgent: userAgent,
        isActive: true,
        lastError: null,
      },
    });
    return { accountId: account.id, shopId: info.shopId };
  }

  /**
   * Generate authorize URL. Frontend redirect user ke URL ini, user login
   * Shopee + authorize → Shopee redirect ke SHOPEE_REDIRECT_URL dengan
   * ?code=...&shop_id=...
   */
  buildAuthorizeUrl(): string {
    return this.shopeeApi.buildAuthorizeUrl();
  }

  /**
   * Callback handler. Exchange code → token, save ke ShopeeAccount.
   * Kalau shop sudah pernah connect, update token-nya (tidak duplikat row).
   */
  async handleCallback(
    companyId: string,
    code: string,
    shopId: string,
  ): Promise<{ accountId: string; shopName: string | null }> {
    const tokenData = await this.shopeeApi.exchangeCodeForToken(code, shopId);
    const expiresAt = new Date(Date.now() + tokenData.expireIn * 1000);
    // Refresh token Shopee valid ~30 hari sejak granted.
    const refreshExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );

    // Fetch shop info untuk display name. Kalau gagal, tetap simpan token
    // — display fallback ke "Shop #shop_id".
    let shopName: string | null = null;
    try {
      const info = await this.shopeeApi.getShopInfo(
        tokenData.accessToken,
        shopId,
      );
      shopName = info.shopName;
    } catch (err) {
      this.logger.warn(
        `getShopInfo gagal saat connect: ${err instanceof Error ? err.message : err}`,
      );
    }

    const account = await this.prisma.shopeeAccount.upsert({
      where: {
        companyId_shopId: { companyId, shopId },
      },
      create: {
        companyId,
        shopId,
        shopName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        refreshExpiresAt,
        isActive: true,
      },
      update: {
        shopName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        refreshExpiresAt,
        isActive: true,
        lastError: null,
      },
    });
    return { accountId: account.id, shopName };
  }

  async listAccounts(companyId: string) {
    const accounts = await this.prisma.shopeeAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: {
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
      },
    });
    return accounts.map((a) => ({
      id: a.id,
      shopId: a.shopId,
      shopName: a.shopName,
      region: a.region,
      isActive: a.isActive,
      // Hint untuk UI — kalau refresh_token sudah > 28 hari, warn user.
      refreshTokenDaysLeft: a.refreshExpiresAt
        ? Math.max(
            0,
            Math.floor(
              (a.refreshExpiresAt.getTime() - Date.now()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : null,
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      lastError: a.lastError,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async disconnect(companyId: string, accountId: string): Promise<void> {
    const account = await this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    await this.prisma.shopeeAccount.delete({ where: { id: accountId } });
  }

  /**
   * Ambil token yang masih valid untuk account. Kalau access_token mau
   * expire dalam < 5 menit, refresh dulu pakai refresh_token.
   */
  private async getValidAccessToken(accountId: string): Promise<{
    accessToken: string;
    shopId: string;
  }> {
    const account = await this.prisma.shopeeAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");

    // Only valid for OAUTH mode — caller harus cek connectionMode dulu.
    if (!account.accessToken || !account.refreshToken || !account.expiresAt) {
      throw new BadRequestException(
        "Akun bukan OAuth mode atau token belum ada.",
      );
    }

    const expiresInMs = account.expiresAt.getTime() - Date.now();
    if (expiresInMs > 5 * 60 * 1000) {
      // Token masih valid > 5 menit.
      return { accessToken: account.accessToken, shopId: account.shopId };
    }

    // Refresh.
    this.logger.log(`[shopee] refresh token untuk shop ${account.shopId}`);
    const refreshed = await this.shopeeApi.refreshAccessToken(
      account.refreshToken,
      account.shopId,
    );
    const newExpiresAt = new Date(Date.now() + refreshed.expireIn * 1000);
    await this.prisma.shopeeAccount.update({
      where: { id: accountId },
      data: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: newExpiresAt,
        lastError: null,
      },
    });
    return { accessToken: refreshed.accessToken, shopId: account.shopId };
  }

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
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        name: name.slice(0, 200),
        sellingPrice,
        stock,
        imageUrl,
      },
    });
    // Update default ProductUnit (kalau ada) — biar form edit nampilin harga
    // baru. Pakai updateMany supaya tidak error kalau belum ada default unit.
    await this.prisma.productUnit.updateMany({
      where: { productId, isDefault: true },
      data: { sellingPrice },
    });
    // Update / create per-branch price + stock untuk semua cabang aktif.
    const branches = await this.prisma.branch.findMany({
      where: { companyId, isActive: true },
      select: { id: true },
    });
    for (const b of branches) {
      await this.prisma.branchProductPrice.upsert({
        where: {
          branchId_productId: { branchId: b.id, productId },
        },
        create: {
          branchId: b.id,
          productId,
          sellingPrice,
          purchasePrice: 0,
        },
        update: { sellingPrice },
      });
      await this.prisma.branchStock.upsert({
        where: {
          branchId_productId: { branchId: b.id, productId },
        },
        create: {
          branchId: b.id,
          productId,
          quantity: stock,
          minStock: 5,
        },
        update: { quantity: stock },
      });
    }
  }

  /**
   * Cari atau buat kategori "Shopee Import" untuk company. Dipakai sebagai
   * default categoryId saat auto-create Product dari Shopee item.
   */
  private async ensureShopeeImportCategory(
    companyId: string,
  ): Promise<string> {
    const existing = await this.prisma.category.findFirst({
      where: { companyId, name: "Shopee Import", kind: "PRODUCT" },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.category.create({
      data: {
        companyId,
        name: "Shopee Import",
        kind: "PRODUCT",
        description: "Produk auto-imported dari Shopee. Edit jika perlu.",
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * List cached Shopee items dari DB (instant, gak hit Shopee). Frontend
   * panggil ini saat buka halaman. Tombol "Refresh" panggil
   * refreshProducts() untuk re-fetch dari Shopee.
   */
  async listCachedItems(companyId: string, accountId: string) {
    const account = await this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");

    const items = await this.prisma.shopeeItem.findMany({
      where: { shopeeAccountId: accountId },
      orderBy: { lastFetchedAt: "desc" },
      include: {
        product: { select: { id: true, name: true, code: true } },
      },
    });
    return items.map((it) => ({
      id: it.id,
      itemId: it.itemId,
      modelId: it.modelId,
      name: it.name,
      sku: it.sku,
      status: it.status,
      currentPrice: it.currentPrice,
      totalStock: it.totalStock,
      imageUrl: it.imageUrl,
      hasModel: it.hasModel,
      lastFetchedAt: it.lastFetchedAt.toISOString(),
      lastPushedAt: it.lastPushedAt?.toISOString() ?? null,
      linkedProduct: it.product
        ? { id: it.product.id, name: it.product.name, sku: it.product.code }
        : null,
    }));
  }

  /**
   * Link cached ShopeeItem ke produk MiniPOS. Set productId pada row item.
   */
  async linkShopeeItem(
    companyId: string,
    shopeeItemId: string,
    productId: string,
  ): Promise<void> {
    const [item, product] = await Promise.all([
      this.prisma.shopeeItem.findFirst({
        where: {
          id: shopeeItemId,
          account: { companyId },
        },
        select: { id: true },
      }),
      this.prisma.product.findFirst({
        where: { id: productId, companyId },
        select: { id: true },
      }),
    ]);
    if (!item) throw new NotFoundException("Shopee item tidak ditemukan");
    if (!product) throw new NotFoundException("Produk MiniPOS tidak ditemukan");
    await this.prisma.shopeeItem.update({
      where: { id: shopeeItemId },
      data: { productId },
    });
  }

  async unlinkShopeeItem(
    companyId: string,
    shopeeItemId: string,
  ): Promise<void> {
    const item = await this.prisma.shopeeItem.findFirst({
      where: { id: shopeeItemId, account: { companyId } },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("Shopee item tidak ditemukan");
    await this.prisma.shopeeItem.update({
      where: { id: shopeeItemId },
      data: { productId: null },
    });
  }

  /**
   * Cek apakah cookie session masih valid. Lightweight call ke Shopee
   * endpoint search_product_list (page_size=1) — kalau response OK, cookie
   * masih hidup. Kalau 401/403, expired.
   */
  async verifyConnection(
    companyId: string,
    accountId: string,
  ): Promise<{
    cookieValid: boolean;
    tokensSet: boolean;
    error?: string;
  }> {
    const account = await this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    if (account.connectionMode !== "COOKIE") {
      return { cookieValid: false, tokensSet: false, error: "Bukan akun mode COOKIE" };
    }
    if (!account.sellerCookie) {
      return { cookieValid: false, tokensSet: false, error: "Cookie belum di-set" };
    }
    const tokens = account.scrapingTokens as { xSapRi?: string; xSapSec?: string } | null;
    const tokensSet = !!(tokens?.xSapRi && tokens?.xSapSec);
    try {
      await this.scraper.verifyCookie(
        account.sellerCookie,
        account.cookieUserAgent,
      );
      // Cookie valid — clear any lastError.
      await this.prisma.shopeeAccount.update({
        where: { id: account.id },
        data: { lastError: null },
      });
      return { cookieValid: true, tokensSet };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await this.prisma.shopeeAccount.update({
        where: { id: account.id },
        data: { lastError: msg },
      });
      return { cookieValid: false, tokensSet, error: msg };
    }
  }

  /**
   * Cek apakah Product MiniPOS punya ShopeeItem yang ter-link.
   * Dipakai UI product edit form untuk nampilkan tombol "Push ke Shopee"
   * conditionally.
   */
  async getProductLinkStatus(
    companyId: string,
    productId: string,
  ): Promise<{
    linked: boolean;
    shopeeItemId: string | null;
    shopeeAccountId: string | null;
  }> {
    const item = await this.prisma.shopeeItem.findFirst({
      where: {
        productId,
        account: { companyId, isActive: true },
      },
      select: { id: true, shopeeAccountId: true },
    });
    return {
      linked: !!item,
      shopeeItemId: item?.id ?? null,
      shopeeAccountId: item?.shopeeAccountId ?? null,
    };
  }

  /**
   * Return list productId yang sudah linked dengan Shopee item (untuk
   * company aktif). Frontend products list pakai ini supaya tahu mana
   * produk yang punya tombol "Update Stok Shopee".
   */
  async getLinkedProductIds(companyId: string): Promise<string[]> {
    const items = await this.prisma.shopeeItem.findMany({
      where: {
        productId: { not: null },
        account: { companyId, isActive: true },
      },
      select: { productId: true },
      distinct: ["productId"],
    });
    return items
      .map((i) => i.productId)
      .filter((id): id is string => id != null);
  }

  /**
   * Quick update stok: set BranchStock untuk satu cabang + push ke Shopee
   * sekaligus. Dipakai dialog "Update Stok Shopee" di products list.
   */
  async quickUpdateStock(params: {
    companyId: string;
    productId: string;
    branchId: string;
    newStock: number;
  }): Promise<{ pushedToShopee: boolean; shopeeError?: string }> {
    const { companyId, productId, branchId, newStock } = params;
    if (newStock < 0) throw new BadRequestException("Stok tidak boleh negatif");
    const safeStock = Math.floor(newStock);

    // Validasi product + branch belong to company.
    const [product, branch] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.branch.findFirst({
        where: { id: branchId, companyId, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");

    // 1) Update BranchStock di MiniPOS.
    await this.prisma.branchStock.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, quantity: safeStock, minStock: 5 },
      update: { quantity: safeStock },
    });
    // Note: DB trigger akan auto-sync Product.stock = SUM(BranchStock).

    // 2) Push ke Shopee — best effort. Kalau gagal, MiniPOS update tetap
    // tersimpan, hanya report bahwa Shopee belum sinkron.
    const shopeeItem = await this.prisma.shopeeItem.findFirst({
      where: {
        productId,
        account: { companyId, isActive: true },
      },
      select: { id: true },
    });
    if (!shopeeItem) {
      return { pushedToShopee: false, shopeeError: "Produk tidak ter-link ke Shopee" };
    }
    try {
      await this.pushStockForItem(companyId, shopeeItem.id, safeStock);
      return { pushedToShopee: true };
    } catch (err) {
      return {
        pushedToShopee: false,
        shopeeError: err instanceof Error ? err.message : "unknown",
      };
    }
  }

  /**
   * Push stok produk MiniPOS dari cabang tertentu ke Shopee.
   * Caller kasih productId + branchId, kita lookup:
   *  - ShopeeItem yang linked dgn productId (asumsi 1-to-1)
   *  - BranchStock untuk (productId, branchId)
   *  - Push value tsb ke Shopee
   */
  async pushStockFromBranch(
    companyId: string,
    productId: string,
    branchId: string,
  ): Promise<{ pushedAt: string; newStock: number }> {
    // 1) Lookup ShopeeItem linked dengan product ini.
    const item = await this.prisma.shopeeItem.findFirst({
      where: {
        productId,
        account: { companyId, isActive: true },
      },
      select: { id: true },
    });
    if (!item) {
      throw new BadRequestException(
        "Produk ini belum ter-link dengan item Shopee. Sync Shopee dulu.",
      );
    }
    // 2) Lookup BranchStock untuk cabang tsb.
    const bs = await this.prisma.branchStock.findUnique({
      where: {
        branchId_productId: { branchId, productId },
      },
      select: { quantity: true },
    });
    const stockValue = bs?.quantity ?? 0;
    // 3) Push ke Shopee via existing method.
    return this.pushStockForItem(companyId, item.id, stockValue);
  }

  /**
   * Push stok untuk satu ShopeeItem. Item harus sudah punya modelId (untuk
   * produk dengan model_list — semua row di cache kita punya modelId).
   */
  async pushStockForItem(
    companyId: string,
    shopeeItemId: string,
    newStock: number,
  ): Promise<{ pushedAt: string; newStock: number }> {
    if (newStock < 0) throw new BadRequestException("Stok tidak boleh negatif");
    const safeStock = Math.floor(newStock);

    const item = await this.prisma.shopeeItem.findFirst({
      where: { id: shopeeItemId, account: { companyId } },
      include: { account: true },
    });
    if (!item) throw new NotFoundException("Shopee item tidak ditemukan");
    const account = item.account;
    if (account.connectionMode !== "COOKIE") {
      throw new BadRequestException(
        "Push stok via scraping hanya untuk akun mode COOKIE.",
      );
    }
    if (!account.sellerCookie) {
      throw new BadRequestException(
        "Cookie session belum di-set. Re-connect Shopee dulu.",
      );
    }
    const tokens = account.scrapingTokens as ScrapingTokens | null;
    if (!tokens?.xSapRi || !tokens?.xSapSec) {
      throw new BadRequestException(
        "Anti-bot tokens belum di-set. Klik Update Tokens dulu.",
      );
    }
    if (!item.modelId || item.modelId === "0") {
      throw new BadRequestException(
        "Item ini tidak punya modelId Shopee. Klik Refresh Products dulu agar data Shopee re-fetched dengan model_list.",
      );
    }

    try {
      await this.scraper.updateStock({
        cookie: account.sellerCookie,
        userAgent: account.cookieUserAgent,
        tokens,
        productId: Number(item.itemId),
        modelId: Number(item.modelId),
        locationId: "IDZ",
        sellableStock: safeStock,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.shopeeAccount.update({
        where: { id: account.id },
        data: { lastError: msg },
      });
      throw err;
    }

    const now = new Date();
    await this.prisma.shopeeItem.update({
      where: { id: shopeeItemId },
      data: { totalStock: safeStock, lastPushedAt: now },
    });
    await this.prisma.shopeeAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: now, lastError: null },
    });

    return { pushedAt: now.toISOString(), newStock: safeStock };
  }

  /**
   * Fetch SEMUA produk di shop (paginated loop). Return list dengan field
   * yang UI butuh: name, image, price, stock, status, sku.
   */
  async fetchProducts(
    companyId: string,
    accountId: string,
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
    const account = await this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
    });
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
              const matched = await this.prisma.product.findFirst({
                where: {
                  companyId,
                  OR: [
                    { code: skuForMatch },
                    { barcode: skuForMatch },
                  ],
                },
                select: { id: true },
              });
              autoMatchProductId = matched?.id ?? null;
            }

            // Auto-create Product kalau belum match — supaya produk Shopee
            // muncul di master data MiniPOS. Skip kalau ShopeeItem ini sudah
            // pernah punya productId YANG MASIH HIDUP (preserve manual link).
            const existingItem = await this.prisma.shopeeItem.findUnique({
              where: {
                shopeeAccountId_itemId_modelId: {
                  shopeeAccountId: accountId,
                  itemId: itemIdStr,
                  modelId: modelIdStr,
                },
              },
              select: { productId: true },
            });
            // Validasi: linked product masih ada & belum di-soft-delete.
            // Kalau user pernah delete produk yg di-link Shopee:
            //   - REVIVE soft-deleted product (clear deletedAt + isActive=true)
            //     supaya muncul lagi di list MiniPOS tanpa duplikat.
            //   - Preserve link (productId di ShopeeItem tetap valid).
            let linkedAlive = false;
            if (existingItem?.productId) {
              const linked = await this.prisma.product.findFirst({
                where: { id: existingItem.productId },
                select: { id: true, deletedAt: true },
              });
              if (linked) {
                if (linked.deletedAt) {
                  // Revive: clear soft-delete & re-activate.
                  await this.prisma.product.update({
                    where: { id: linked.id },
                    data: { deletedAt: null, isActive: true },
                  });
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
              const codeCollision = await this.prisma.product.findFirst({
                where: { companyId, code: productCode },
                select: { id: true },
              });
              const finalCode = codeCollision
                ? `${productCode}-${Math.random().toString(36).slice(2, 6)}`
                : productCode;
              const sellingPriceVal = item.currentPrice ?? 0;
              const stockVal = m.stock ?? item.totalStock ?? 0;
              const newProduct = await this.prisma.product.create({
                data: {
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
                },
                select: { id: true },
              });
              autoMatchProductId = newProduct.id;
              createdProductCount++;

              // Populate per-branch price + stock supaya tab "Harga & Stok"
              // di product edit form tidak kosong. Skip kalau company belum
              // punya branch (rare edge case).
              const branches = await this.prisma.branch.findMany({
                where: { companyId, isActive: true },
                select: { id: true },
              });
              if (branches.length > 0) {
                await this.prisma.branchProductPrice.createMany({
                  data: branches.map((b) => ({
                    branchId: b.id,
                    productId: newProduct.id,
                    sellingPrice: sellingPriceVal,
                    purchasePrice: 0,
                  })),
                  skipDuplicates: true,
                });
                await this.prisma.branchStock.createMany({
                  data: branches.map((b) => ({
                    branchId: b.id,
                    productId: newProduct.id,
                    quantity: stockVal,
                    minStock: 5,
                  })),
                  skipDuplicates: true,
                });
              }
            }
            await this.prisma.shopeeItem.upsert({
              where: {
                shopeeAccountId_itemId_modelId: {
                  shopeeAccountId: accountId,
                  itemId: itemIdStr,
                  modelId: modelIdStr,
                },
              },
              create: {
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
              update: {
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
            });
          }
        }
        await this.prisma.shopeeAccount.update({
          where: { id: accountId },
          data: { lastSyncedAt: now, lastError: null },
        });
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
        await this.prisma.shopeeAccount.update({
          where: { id: accountId },
          data: { lastError: msg },
        });
        throw err;
      }
    }

    // OAUTH mode (default): pakai official API.
    if (!account.accessToken) {
      throw new BadRequestException(
        "Akun OAuth tidak punya access_token. Re-authorize Shopee.",
      );
    }
    const { accessToken, shopId } = await this.getValidAccessToken(accountId);

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
    await this.prisma.shopeeAccount.update({
      where: { id: accountId },
      data: { lastSyncedAt: new Date(), lastError: null },
    });

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

  /**
   * Simpan anti-bot tokens untuk akun COOKIE. Tokens di-paste user dari
   * DevTools (request POST quick_edit di tab Network → Headers). Tokens ini
   * expire per session (~15 menit s.d. beberapa jam) — user wajib refresh
   * manual saat dapat error 401/403 atau code != 0 saat push stock.
   */
  async setScrapingTokens(
    companyId: string,
    accountId: string,
    tokens: ScrapingTokens,
  ): Promise<void> {
    if (!tokens.xSapRi || !tokens.xSapSec) {
      throw new BadRequestException(
        "x-sap-ri dan x-sap-sec wajib di-isi",
      );
    }
    const account = await this.prisma.shopeeAccount.findFirst({
      where: { id: accountId, companyId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    await this.prisma.shopeeAccount.update({
      where: { id: accountId },
      data: { scrapingTokens: tokens as unknown as object },
    });
  }

  /**
   * Link produk MiniPOS ke item Shopee. Idempotent — kalau sudah ada
   * mapping untuk kombinasi (marketplace, item_id, model_id), update.
   */
  async linkProduct(
    companyId: string,
    params: {
      productId: string;
      shopeeAccountId: string;
      externalItemId: string;
      externalModelId: string;
      externalSku?: string | null;
    },
  ): Promise<{ id: string }> {
    // Validasi: account & product belong ke company.
    const [account, product] = await Promise.all([
      this.prisma.shopeeAccount.findFirst({
        where: { id: params.shopeeAccountId, companyId },
        select: { id: true },
      }),
      this.prisma.product.findFirst({
        where: { id: params.productId, companyId },
        select: { id: true },
      }),
    ]);
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    if (!product) throw new NotFoundException("Produk tidak ditemukan");

    const existing = await this.prisma.productMarketplaceMapping.findFirst({
      where: {
        marketplace: "SHOPEE",
        externalItemId: params.externalItemId,
        externalModelId: params.externalModelId,
      },
      select: { id: true },
    });

    if (existing) {
      const updated = await this.prisma.productMarketplaceMapping.update({
        where: { id: existing.id },
        data: {
          productId: params.productId,
          shopeeAccountId: params.shopeeAccountId,
          externalSku: params.externalSku ?? null,
          syncEnabled: true,
        },
      });
      return { id: updated.id };
    }

    const created = await this.prisma.productMarketplaceMapping.create({
      data: {
        productId: params.productId,
        marketplace: "SHOPEE",
        externalItemId: params.externalItemId,
        externalModelId: params.externalModelId,
        externalSku: params.externalSku ?? null,
        shopeeAccountId: params.shopeeAccountId,
        syncEnabled: true,
      },
    });
    return { id: created.id };
  }

  async unlinkProduct(companyId: string, mappingId: string): Promise<void> {
    const mapping = await this.prisma.productMarketplaceMapping.findFirst({
      where: {
        id: mappingId,
        shopeeAccount: { companyId },
      },
      select: { id: true },
    });
    if (!mapping) throw new NotFoundException("Mapping tidak ditemukan");
    await this.prisma.productMarketplaceMapping.delete({
      where: { id: mappingId },
    });
  }

  async listMappings(companyId: string, accountId: string) {
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

  /**
   * Push stok current MiniPOS untuk produk ke Shopee. Caller harus kasih
   * `newStock` (hasil aggregate stock di branch yang dipilih). Service ini
   * tidak menghitung sendiri — biar caller (UI / hook) yang menentukan stok
   * mana yang dipush (per-branch atau total).
   */
  async pushStockToShopee(
    companyId: string,
    mappingId: string,
    newStock: number,
  ): Promise<{ pushedAt: string; newStock: number }> {
    if (newStock < 0)
      throw new BadRequestException("Stok tidak boleh negatif");
    const safeStock = Math.floor(newStock);

    const mapping = await this.prisma.productMarketplaceMapping.findFirst({
      where: {
        id: mappingId,
        marketplace: "SHOPEE",
        shopeeAccount: { companyId },
      },
      include: { shopeeAccount: true },
    });
    if (!mapping) throw new NotFoundException("Mapping tidak ditemukan");
    if (!mapping.syncEnabled)
      throw new BadRequestException("Sync mapping ini di-disable");

    const account = mapping.shopeeAccount;
    if (!account)
      throw new BadRequestException("Mapping tidak punya akun Shopee");
    if (account.connectionMode !== "COOKIE") {
      throw new BadRequestException(
        "Push stok via scraping hanya untuk akun mode COOKIE. Untuk OAuth pakai endpoint resmi (belum implemented).",
      );
    }
    if (!account.sellerCookie) {
      throw new BadRequestException(
        "Cookie session belum di-set. Re-connect Shopee dulu.",
      );
    }
    const tokens = account.scrapingTokens as ScrapingTokens | null;
    if (!tokens?.xSapRi || !tokens?.xSapSec) {
      throw new BadRequestException(
        "Anti-bot tokens belum di-set. Buka Pengaturan Shopee → Update Tokens, paste dari DevTools.",
      );
    }
    if (!mapping.externalModelId) {
      throw new BadRequestException(
        "Mapping tidak punya externalModelId (Shopee model_id). Re-link produk dengan model_id yang benar.",
      );
    }

    try {
      await this.scraper.updateStock({
        cookie: account.sellerCookie,
        userAgent: account.cookieUserAgent,
        tokens,
        productId: Number(mapping.externalItemId),
        modelId: Number(mapping.externalModelId),
        locationId: "IDZ",
        sellableStock: safeStock,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.shopeeAccount.update({
        where: { id: account.id },
        data: { lastError: msg },
      });
      throw err;
    }

    const now = new Date();
    await this.prisma.productMarketplaceMapping.update({
      where: { id: mappingId },
      data: { lastSyncedAt: now, lastMarketplaceStock: safeStock },
    });
    await this.prisma.shopeeAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: now, lastError: null },
    });

    return { pushedAt: now.toISOString(), newStock: safeStock };
  }
}
