import { Injectable, Logger } from "@nestjs/common";

/**
 * Scraper untuk Shopee Seller Center internal API.
 *
 * PoC — JANGAN dipakai production untuk customer banyak. Risk:
 * - Cookie session expire 24-72 jam → user wajib paste ulang
 * - Endpoint internal bisa berubah kapan saja
 * - Shopee bisa detect & ban toko kalau request pattern mencurigakan
 *
 * Hanya recommended untuk: in-house tool, satu toko sendiri, sambil tunggu
 * approval Shopee Open Platform.
 *
 * Endpoint utama: /api/v3/opt/mpsku/list/v2/search_product_list — list
 * produk dengan paginated cursor + filter.
 */
@Injectable()
export class ShopeeScraperService {
  private readonly logger = new Logger(ShopeeScraperService.name);

  private readonly BASE = "https://seller.shopee.co.id";
  private readonly DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

  /**
   * Fetch semua produk pakai cookie session. Loop pagination sampai habis
   * (cap 1000 item safety). Cookie format: "k1=v1; k2=v2; ...".
   */
  async fetchAllProducts(
    cookie: string,
    userAgent: string | null,
  ): Promise<{
    totalCount: number;
    items: Array<{
      itemId: number;
      name: string;
      sku: string | null;
      status: string;
      currentPrice: number | null;
      originalPrice: number | null;
      currency: string;
      totalStock: number | null;
      imageUrl: string | null;
      hasModel: boolean;
      updateTime: string | null;
      models: Array<{ id: number; name: string | null; sku: string | null; stock: number | null }>;
    }>;
  }> {
    if (!cookie) {
      throw new Error("Cookie session kosong");
    }
    // Extract SPC_CDS dari cookie untuk query param (dipakai Shopee sebagai
    // anti-CSRF token tambahan).
    const spcCds = this.extractCookieValue(cookie, "SPC_CDS");
    if (!spcCds) {
      throw new Error(
        "Cookie tidak valid — tidak ditemukan SPC_CDS. Pastikan paste cookie lengkap dari seller.shopee.co.id.",
      );
    }

    const ua = userAgent || this.DEFAULT_UA;
    const PAGE_SIZE = 48;
    const MAX_PAGES = 30; // Safety cap (1440 item max)
    const aggregated: ScrapedItem[] = [];
    let totalCount = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(
        `${this.BASE}/api/v3/opt/mpsku/list/v2/search_product_list`,
      );
      url.searchParams.set("SPC_CDS", spcCds);
      url.searchParams.set("SPC_CDS_VER", "2");
      url.searchParams.set("page_number", String(page));
      url.searchParams.set("page_size", String(PAGE_SIZE));
      url.searchParams.set("list_type", "all");
      url.searchParams.set("operation_sort_by", "recommend_v4");
      url.searchParams.set("need_ads", "false");

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "id-ID,id;q=0.9,en;q=0.8",
          "caller-source": "local_pc",
          cookie,
          locale: "id",
          referer: `${this.BASE}/portal/product/list/all`,
          "user-agent": ua,
        },
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Cookie session expired / invalid. Silakan paste cookie baru dari browser seller Shopee.",
        );
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Shopee scraper HTTP ${res.status}: ${txt.slice(0, 200)}`,
        );
      }

      const json = (await res.json()) as ShopeeListResponse;
      if (json.code && json.code !== 0) {
        throw new Error(
          `Shopee API error: code=${json.code}, msg=${json.message || ""}`,
        );
      }

      const pageItems = json.data?.products ?? json.data?.list ?? [];
      if (pageItems.length === 0) break;

      // Dump struktur 1 item pertama supaya gampang debug kalau field
      // price/stock null — Shopee bisa kapan saja ganti shape response.
      if (page === 1 && pageItems[0]) {
        try {
          const sample = JSON.stringify(pageItems[0]).slice(0, 3000);
          this.logger.log(`[shopee scraper] sample item: ${sample}`);
        } catch {
          // ignore
        }
      }

      aggregated.push(...pageItems);
      totalCount =
        json.data?.page_info?.total ?? json.data?.total ?? aggregated.length;

      // Stop kalau kurang dari page size (page terakhir).
      if (pageItems.length < PAGE_SIZE) break;
      if (aggregated.length >= totalCount) break;
    }

    return {
      totalCount,
      items: aggregated.map((p) => this.normalize(p)),
    };
  }

  /**
   * Verify cookie valid dengan call lightweight endpoint. Return shop info
   * kalau OK, throw kalau cookie expired.
   */
  async verifyCookie(
    cookie: string,
    userAgent: string | null,
  ): Promise<{ shopId: string; shopName: string | null }> {
    const spcCds = this.extractCookieValue(cookie, "SPC_CDS");
    if (!spcCds) throw new Error("Cookie tidak punya SPC_CDS");

    // Pakai SPC_U sebagai shop_id (user_id seller). Sebenarnya bukan shop_id
    // resmi tapi cukup untuk identifikasi unik.
    const userId = this.extractCookieValue(cookie, "SPC_U");
    if (!userId) {
      throw new Error("Cookie tidak punya SPC_U — bukan cookie seller yang valid");
    }

    // Lightweight call untuk verify cookie alive. /api/v3/general/get_shop_info_v2
    // atau endpoint serupa. Kita coba pakai endpoint search_product_list dengan
    // page_size=1 supaya ringan.
    const ua = userAgent || this.DEFAULT_UA;
    const url = new URL(
      `${this.BASE}/api/v3/opt/mpsku/list/v2/search_product_list`,
    );
    url.searchParams.set("SPC_CDS", spcCds);
    url.searchParams.set("SPC_CDS_VER", "2");
    url.searchParams.set("page_number", "1");
    url.searchParams.set("page_size", "1");
    url.searchParams.set("list_type", "all");

    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json, text/plain, */*",
        cookie,
        referer: `${this.BASE}/portal/product/list/all`,
        "user-agent": ua,
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Cookie expired atau invalid");
    }
    if (!res.ok) {
      throw new Error(`Cookie verify HTTP ${res.status}`);
    }

    return { shopId: userId, shopName: null };
  }

  /**
   * Push stok baru ke Shopee untuk satu produk/model.
   *
   * Endpoint: POST /api/v3/product/update_product_info_for_quick_edit
   * Body: { product_id, product_info: { model_list: [{id, stock_setting_list:
   *   [{location_id, sellable_stock}]}]}, is_draft: false }
   *
   * Endpoint write WAJIB anti-bot tokens (x-sap-ri, x-sap-sec, dst). Tanpa
   * tokens valid, Shopee reject dengan code != 0 atau HTTP 403.
   */
  async updateStock(params: {
    cookie: string;
    userAgent: string | null;
    tokens: ScrapingTokens;
    productId: number;
    modelId: number;
    locationId: string; // misal "IDZ" untuk Indonesia gudang virtual
    sellableStock: number;
  }): Promise<void> {
    const { cookie, userAgent, tokens } = params;
    if (!cookie) throw new Error("Cookie session kosong");
    if (!tokens?.xSapSec || !tokens?.xSapRi) {
      throw new Error(
        "Anti-bot tokens (x-sap-ri / x-sap-sec) wajib di-set untuk update stok. Paste dari DevTools Shopee Seller dulu.",
      );
    }

    const spcCds = this.extractCookieValue(cookie, "SPC_CDS");
    if (!spcCds) {
      throw new Error(
        "Cookie tidak valid — tidak ditemukan SPC_CDS.",
      );
    }

    const ua = userAgent || this.DEFAULT_UA;
    const url = new URL(
      `${this.BASE}/api/v3/product/update_product_info_for_quick_edit`,
    );
    url.searchParams.set("SPC_CDS", spcCds);
    url.searchParams.set("SPC_CDS_VER", "2");

    const body = {
      product_id: params.productId,
      product_info: {
        model_list: [
          {
            id: params.modelId,
            stock_setting_list: [
              {
                location_id: params.locationId,
                sellable_stock: params.sellableStock,
              },
            ],
          },
        ],
      },
      is_draft: false,
    };

    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      "accept-language": "id-ID,id;q=0.9,en;q=0.8",
      "content-type": "application/json;charset=UTF-8",
      cookie,
      "entrance-identification": "3",
      locale: "id",
      origin: this.BASE,
      referer: `${this.BASE}/portal/product/list/all`,
      "user-agent": ua,
      "x-sap-ri": tokens.xSapRi,
      "x-sap-sec": tokens.xSapSec,
    };
    if (tokens.afAcEncSzToken) headers["af-ac-enc-sz-token"] = tokens.afAcEncSzToken;
    if (tokens.scFeSession) headers["sc-fe-session"] = tokens.scFeSession;
    if (tokens.scFeVer) headers["sc-fe-ver"] = tokens.scFeVer;

    const res = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Cookie atau anti-bot token expired. Paste ulang dari browser Shopee Seller.",
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(
        `Shopee update_stock HTTP ${res.status}: ${txt.slice(0, 200)}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      user_message?: string;
    };
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(
        `Shopee update_stock gagal: code=${json.code}, msg=${json.user_message || json.msg || "unknown"}`,
      );
    }

    this.logger.log(
      `[shopee] update stok product_id=${params.productId} model_id=${params.modelId} → ${params.sellableStock}`,
    );
  }

  // ─── helpers ────────────────────────────────────────────────────

  private extractCookieValue(cookieStr: string, key: string): string | null {
    const parts = cookieStr.split(";").map((p) => p.trim());
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      const k = p.slice(0, eq).trim();
      if (k === key) return p.slice(eq + 1).trim();
    }
    return null;
  }

  private normalize(p: ScrapedItem): {
    itemId: number;
    name: string;
    sku: string | null;
    status: string;
    currentPrice: number | null;
    originalPrice: number | null;
    currency: string;
    totalStock: number | null;
    imageUrl: string | null;
    hasModel: boolean;
    updateTime: string | null;
    models: Array<{ id: number; name: string | null; sku: string | null; stock: number | null }>;
  } {
    // Struktur asli MPSKU v2:
    //   price_detail.price_min / price_max  → string "10000.00" (sudah IDR)
    //   price_detail.selling_price_min      → string (harga jual setelah diskon)
    //   stock_detail.total_available_stock  → integer langsung
    //   model_list[].price_detail.origin_price / promotion_price
    //   model_list[].stock_detail.total_available_stock
    const priceDetail = p.price_detail;
    const stockDetail = p.stock_detail;
    const firstModel = Array.isArray(p.model_list) && p.model_list.length > 0
      ? p.model_list[0]
      : null;

    const currentPrice =
      parseIdrString(priceDetail?.selling_price_min) ??
      parseIdrString(priceDetail?.price_min) ??
      parseIdrString(firstModel?.price_detail?.promotion_price, { skipZero: true }) ??
      parseIdrString(firstModel?.price_detail?.origin_price);

    const originalPrice =
      parseIdrString(priceDetail?.price_max) ??
      parseIdrString(priceDetail?.price_min) ??
      parseIdrString(firstModel?.price_detail?.origin_price);

    const stockCandidates: Array<number | undefined> = [
      stockDetail?.total_available_stock,
      stockDetail?.total_seller_stock,
      firstModel?.stock_detail?.total_available_stock,
      firstModel?.stock_detail?.total_seller_stock,
    ];
    let stock: number | null =
      stockCandidates.find((v) => typeof v === "number") ?? null;

    // Kalau ada >1 model, sum stok semua model.
    if (Array.isArray(p.model_list) && p.model_list.length > 1) {
      stock = p.model_list.reduce((sum, m) => {
        const s =
          m.stock_detail?.total_available_stock ??
          m.stock_detail?.total_seller_stock ??
          0;
        return sum + (typeof s === "number" ? s : 0);
      }, 0);
    }

    let img: string | null =
      typeof p.cover_image === "string" && p.cover_image
        ? p.cover_image
        : firstModel?.image && typeof firstModel.image === "string"
          ? firstModel.image
          : null;
    if (img && !img.startsWith("http")) {
      img = `https://down-id.img.susercontent.com/file/${img}`;
    }

    // status: integer (1=NORMAL/published, 0=unlist/banned, dll). Map ke
    // string supaya frontend tinggal pakai.
    const statusMap: Record<number, string> = {
      1: "NORMAL",
      0: "UNLIST",
      2: "BANNED",
      3: "DELETED",
    };
    const statusStr =
      typeof p.status === "number"
        ? statusMap[p.status] ?? `STATUS_${p.status}`
        : typeof p.status === "string"
          ? p.status
          : "NORMAL";

    const updateTs = p.modify_time ?? p.update_time ?? p.create_time ?? null;

    const models = Array.isArray(p.model_list)
      ? p.model_list
          .map((m) => ({
            id: m.id ?? 0,
            name: m.name || null,
            sku: m.sku || null,
            stock:
              m.stock_detail?.total_available_stock ??
              m.stock_detail?.total_seller_stock ??
              null,
          }))
          .filter((m) => m.id > 0)
      : [];

    return {
      itemId: p.id ?? p.item_id ?? 0,
      name: p.name ?? p.item_name ?? "",
      sku: p.parent_sku || firstModel?.sku || null,
      status: statusStr,
      currentPrice,
      originalPrice,
      currency: "IDR",
      totalStock: stock,
      imageUrl: img,
      hasModel: Array.isArray(p.model_list) && p.model_list.length > 0,
      updateTime: updateTs ? new Date(updateTs * 1000).toISOString() : null,
      models,
    };
  }
}

/**
 * Parse Shopee price string "10000.00" → 10000 (integer Rupiah).
 * Return null kalau invalid. Option `skipZero` untuk skip "0.00" (yang
 * artinya tidak ada harga promo).
 */
function parseIdrString(
  raw: string | number | null | undefined,
  opts?: { skipZero?: boolean },
): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  if (opts?.skipZero && n === 0) return null;
  return Math.round(n);
}

/**
 * Anti-bot tokens yang Shopee fire saat write op. Dipaste user dari DevTools
 * (tab Network → request POST update_product_info → Headers).
 */
export interface ScrapingTokens {
  xSapRi: string;
  xSapSec: string;
  afAcEncSzToken?: string;
  scFeSession?: string;
  scFeVer?: string;
}

interface ShopeeListResponse {
  code?: number;
  message?: string;
  data?: {
    total?: number;
    page_info?: { total?: number; cursor?: string };
    products?: ScrapedItem[];
    list?: ScrapedItem[];
  };
}

interface PriceDetail {
  price_min?: string;
  price_max?: string;
  selling_price_min?: string;
  selling_price_max?: string;
  origin_price?: string;
  promotion_price?: string;
  has_discount?: boolean;
  max_discount?: number;
  max_discount_percentage?: number;
}

interface StockDetail {
  total_available_stock?: number;
  total_seller_stock?: number;
  total_shopee_stock?: number;
}

interface ScrapedItem {
  id?: number;
  item_id?: number;
  name?: string;
  item_name?: string;
  parent_sku?: string;
  status?: number | string;
  cover_image?: string;
  price_detail?: PriceDetail;
  stock_detail?: StockDetail;
  model_list?: Array<{
    id?: number;
    name?: string;
    sku?: string;
    image?: string;
    price_detail?: PriceDetail;
    stock_detail?: StockDetail;
  }>;
  modify_time?: number;
  create_time?: number;
  update_time?: number;
}
