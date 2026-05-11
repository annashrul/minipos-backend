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
import { ShopeeScraperService } from "./shopee-scraper.service";
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
    }>;
    totalCount: number;
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
        await this.prisma.shopeeAccount.update({
          where: { id: accountId },
          data: { lastSyncedAt: new Date(), lastError: null },
        });
        return result;
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
        };
      }),
    };
  }
}
