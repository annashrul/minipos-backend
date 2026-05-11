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

      aggregated.push(...pageItems);
      totalCount = json.data?.total ?? aggregated.length;

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
  } {
    // Shopee internal API return price dalam micro-cents — 100000 raw = Rp 1.000
    // (skala dibagi 100,000 untuk IDR). Cek dengan sample data.
    const rawPrice = p.price ?? p.current_price ?? p.min_price ?? null;
    const currentPrice =
      typeof rawPrice === "number" ? Math.round(rawPrice / 100000) : null;
    const rawOriginal = p.original_price ?? null;
    const originalPrice =
      typeof rawOriginal === "number" ? Math.round(rawOriginal / 100000) : null;

    // Stock: bisa di p.stock atau aggregated dari models.
    let stock: number | null = null;
    if (typeof p.stock === "number") stock = p.stock;
    else if (typeof p.normal_stock === "number") stock = p.normal_stock;
    else if (Array.isArray(p.models)) {
      stock = p.models.reduce((sum, m) => sum + (m.stock ?? 0), 0);
    }

    // Image: ambil cover dari images list atau image_url
    let img: string | null = null;
    if (typeof p.cover_image === "string") img = p.cover_image;
    else if (typeof p.image === "string") img = p.image;
    else if (Array.isArray(p.images) && p.images.length > 0) {
      const first = p.images[0];
      img = typeof first === "string" ? first : (first as { url?: string })?.url ?? null;
    }
    // Shopee image biasanya cuma hash. Prepend CDN URL.
    if (img && !img.startsWith("http")) {
      img = `https://down-id.img.susercontent.com/file/${img}`;
    }

    return {
      itemId: p.id ?? p.item_id ?? 0,
      name: p.name ?? p.item_name ?? "",
      sku: p.sku ?? p.parent_sku ?? null,
      status: p.status ?? p.item_status ?? "NORMAL",
      currentPrice,
      originalPrice,
      currency: "IDR",
      totalStock: stock,
      imageUrl: img,
      hasModel: Array.isArray(p.models) && p.models.length > 0,
      updateTime: p.update_time
        ? new Date(p.update_time * 1000).toISOString()
        : null,
    };
  }
}

interface ShopeeListResponse {
  code?: number;
  message?: string;
  data?: {
    total?: number;
    products?: ScrapedItem[];
    list?: ScrapedItem[];
  };
}

interface ScrapedItem {
  id?: number;
  item_id?: number;
  name?: string;
  item_name?: string;
  sku?: string;
  parent_sku?: string;
  status?: string;
  item_status?: string;
  price?: number;
  current_price?: number;
  original_price?: number;
  min_price?: number;
  stock?: number;
  normal_stock?: number;
  cover_image?: string;
  image?: string;
  images?: Array<string | { url?: string }>;
  models?: Array<{ stock?: number }>;
  update_time?: number;
}
