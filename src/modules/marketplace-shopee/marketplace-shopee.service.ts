import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ShopeeApiService,
} from "./shopee-api.service";
import {
  ShopeeScraperService,
  type ScrapingTokens,
} from "./shopee-scraper.service";
import { ShopeePlaywrightService } from "./shopee-playwright.service";
import { MarketplaceShopeeRepository } from "./marketplace-shopee.repository";
import { ShopeeProductSyncService } from "./shopee-product-sync.service";
import { ShopeeStockSyncService } from "./shopee-stock-sync.service";

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
    private readonly repo: MarketplaceShopeeRepository,
    private readonly shopeeApi: ShopeeApiService,
    private readonly scraper: ShopeeScraperService,
    private readonly playwright: ShopeePlaywrightService,
    private readonly productSync: ShopeeProductSyncService,
    private readonly stockSync: ShopeeStockSyncService,
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

    const account = await this.repo.upsertAccountByCookie(
      companyId,
      info.shopId,
      {
        companyId,
        shopId: info.shopId,
        shopName: info.shopName,
        connectionMode: "COOKIE",
        sellerCookie: cleaned,
        cookieUserAgent: userAgent,
        isActive: true,
      },
      {
        connectionMode: "COOKIE",
        sellerCookie: cleaned,
        cookieUserAgent: userAgent,
        isActive: true,
        lastError: null,
      },
    );
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

    const account = await this.repo.upsertAccountByOAuth(
      companyId,
      shopId,
      {
        companyId,
        shopId,
        shopName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        refreshExpiresAt,
        isActive: true,
      },
      {
        shopName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt,
        refreshExpiresAt,
        isActive: true,
        lastError: null,
      },
    );
    return { accountId: account.id, shopName };
  }

  async listAccounts(companyId: string) {
    const accounts = await this.repo.findManyAccounts(companyId);
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
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId, { id: true });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    await this.repo.deleteAccount(accountId);
  }

  /**
   * Ambil token yang masih valid untuk account. Kalau access_token mau
   * expire dalam < 5 menit, refresh dulu pakai refresh_token.
   */
  private async getValidAccessToken(accountId: string): Promise<{
    accessToken: string;
    shopId: string;
  }> {
    const account = await this.repo.findAccountById(accountId);
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
    await this.repo.updateAccount(accountId, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: newExpiresAt,
      lastError: null,
    });
    return { accessToken: refreshed.accessToken, shopId: account.shopId };
  }

  /**
   * List cached Shopee items dari DB (instant, gak hit Shopee). Frontend
   * panggil ini saat buka halaman. Tombol "Refresh" panggil
   * refreshProducts() untuk re-fetch dari Shopee.
   */
  async listCachedItems(companyId: string, accountId: string) {
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId, { id: true });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");

    const items = await this.repo.findCachedItems(accountId);
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
      this.repo.findShopeeItemByIdAndCompany(shopeeItemId, companyId),
      this.repo.findProductByIdAndCompany(productId, companyId, { id: true }),
    ]);
    if (!item) throw new NotFoundException("Shopee item tidak ditemukan");
    if (!product) throw new NotFoundException("Produk MiniPOS tidak ditemukan");
    await this.repo.updateShopeeItem(shopeeItemId, { productId });
  }

  async unlinkShopeeItem(
    companyId: string,
    shopeeItemId: string,
  ): Promise<void> {
    const item = await this.repo.findShopeeItemByIdAndCompany(shopeeItemId, companyId);
    if (!item) throw new NotFoundException("Shopee item tidak ditemukan");
    await this.repo.updateShopeeItem(shopeeItemId, { productId: null });
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
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId);
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
      await this.repo.updateAccount(account.id, { lastError: null });
      return { cookieValid: true, tokensSet };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await this.repo.updateAccount(account.id, { lastError: msg });
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
    const item = await this.repo.findShopeeItemByProductForLink(productId, companyId);
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
    const items = await this.repo.findLinkedProductIds(companyId);
    return items
      .map((i) => i.productId)
      .filter((id): id is string => id != null);
  }

  // ── Delegated: Product Sync ──────────────────────────────────────

  /**
   * Fetch SEMUA produk di shop (paginated loop). Delegates to
   * ShopeeProductSyncService.
   */
  async fetchProducts(companyId: string, accountId: string) {
    return this.productSync.fetchProducts(
      companyId,
      accountId,
      (aid) => this.getValidAccessToken(aid),
    );
  }

  // ── Delegated: Stock Sync ────────────────────────────────────────

  /**
   * Quick update stok: set BranchStock + push ke Shopee. Delegates to
   * ShopeeStockSyncService.
   */
  async quickUpdateStock(params: {
    companyId: string;
    productId: string;
    branchId: string;
    newStock: number;
  }) {
    return this.stockSync.quickUpdateStock(params);
  }

  /**
   * Push stok produk dari cabang tertentu ke Shopee. Delegates to
   * ShopeeStockSyncService.
   */
  async pushStockFromBranch(
    companyId: string,
    productId: string,
    branchId: string,
  ) {
    return this.stockSync.pushStockFromBranch(companyId, productId, branchId);
  }

  /**
   * Push stok untuk satu ShopeeItem. Delegates to ShopeeStockSyncService.
   */
  async pushStockForItem(
    companyId: string,
    shopeeItemId: string,
    newStock: number,
  ) {
    return this.stockSync.pushStockForItem(companyId, shopeeItemId, newStock);
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
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId, { id: true });
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    await this.repo.updateAccount(accountId, { scrapingTokens: tokens as unknown as object });
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
      this.repo.findAccountByIdAndCompany(params.shopeeAccountId, companyId, { id: true }),
      this.repo.findProductByIdAndCompany(params.productId, companyId, { id: true }),
    ]);
    if (!account) throw new NotFoundException("Akun Shopee tidak ditemukan");
    if (!product) throw new NotFoundException("Produk tidak ditemukan");

    const existing = await this.repo.findMappingByExternal(
      params.externalItemId,
      params.externalModelId,
    );

    if (existing) {
      const updated = await this.repo.updateMapping(existing.id, {
        productId: params.productId,
        shopeeAccountId: params.shopeeAccountId,
        externalSku: params.externalSku ?? null,
        syncEnabled: true,
      });
      return { id: updated.id };
    }

    const created = await this.repo.createMapping({
      productId: params.productId,
      marketplace: "SHOPEE",
      externalItemId: params.externalItemId,
      externalModelId: params.externalModelId,
      externalSku: params.externalSku ?? null,
      shopeeAccountId: params.shopeeAccountId,
      syncEnabled: true,
    });
    return { id: created.id };
  }

  async unlinkProduct(companyId: string, mappingId: string): Promise<void> {
    const mapping = await this.repo.findMappingByIdAndCompany(mappingId, companyId);
    if (!mapping) throw new NotFoundException("Mapping tidak ditemukan");
    await this.repo.deleteMapping(mappingId);
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
   * Push stok current MiniPOS untuk produk ke Shopee via marketplace
   * mapping. Delegates to ShopeeStockSyncService.
   */
  async pushStockToShopee(
    companyId: string,
    mappingId: string,
    newStock: number,
  ) {
    return this.stockSync.pushStockToShopee(companyId, mappingId, newStock);
  }
}
