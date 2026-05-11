import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";

/**
 * Client untuk Shopee Open Platform API.
 *
 * Auth: HMAC SHA256. Tiap request butuh signature dari:
 *   base_string = partner_id + api_path + timestamp + access_token + shop_id
 * Lalu HMAC-SHA256 dengan partner_key sebagai key, hex lower-case.
 *
 * Env yang dibutuhkan:
 * - SHOPEE_PARTNER_ID (numeric string)
 * - SHOPEE_PARTNER_KEY (secret hex string)
 * - SHOPEE_BASE_URL — default production. Sandbox: https://partner.test-stable.shopeemobile.com
 * - SHOPEE_REDIRECT_URL — backend callback URL, harus sama dengan yang
 *   didaftarkan di Shopee partner dashboard.
 */
@Injectable()
export class ShopeeApiService {
  private readonly logger = new Logger(ShopeeApiService.name);

  constructor(private readonly config: ConfigService) {}

  private getPartnerCreds() {
    const partnerId = this.config.get<string>("SHOPEE_PARTNER_ID") ?? "";
    const partnerKey = this.config.get<string>("SHOPEE_PARTNER_KEY") ?? "";
    if (!partnerId || !partnerKey) {
      throw new Error(
        "SHOPEE_PARTNER_ID atau SHOPEE_PARTNER_KEY belum di-set di .env",
      );
    }
    return { partnerId, partnerKey };
  }

  getBaseUrl(): string {
    return (
      this.config.get<string>("SHOPEE_BASE_URL") ??
      "https://partner.shopeemobile.com"
    );
  }

  getRedirectUrl(): string {
    const url = this.config.get<string>("SHOPEE_REDIRECT_URL");
    if (!url) throw new Error("SHOPEE_REDIRECT_URL belum di-set di .env");
    return url;
  }

  /**
   * Generate URL OAuth authorize untuk redirect user ke Shopee.
   * Signature: partner_id + api_path + timestamp → HMAC dengan partner_key.
   * User klik link ini → login Shopee → authorize → Shopee redirect ke
   * SHOPEE_REDIRECT_URL dengan ?code=...&shop_id=...
   */
  buildAuthorizeUrl(): string {
    const { partnerId, partnerKey } = this.getPartnerCreds();
    const apiPath = "/api/v2/shop/auth_partner";
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${partnerId}${apiPath}${timestamp}`;
    const sign = createHmac("sha256", partnerKey)
      .update(baseString)
      .digest("hex");

    const url = new URL(this.getBaseUrl() + apiPath);
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
    url.searchParams.set("redirect", this.getRedirectUrl());
    return url.toString();
  }

  /**
   * Exchange OAuth code → access_token + refresh_token.
   * Signature untuk shop-level token API: partner_id + api_path + timestamp.
   */
  async exchangeCodeForToken(
    code: string,
    shopId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expireIn: number;
  }> {
    const { partnerId, partnerKey } = this.getPartnerCreds();
    const apiPath = "/api/v2/auth/token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.signPublicApi(partnerId, partnerKey, apiPath, timestamp);

    const url = new URL(this.getBaseUrl() + apiPath);
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        shop_id: Number(shopId),
        partner_id: Number(partnerId),
      }),
    });
    const json = (await res.json()) as ShopeeTokenResponse;
    if (json.error) {
      throw new Error(
        `Shopee token exchange gagal: ${json.error} — ${json.message ?? ""}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expireIn: json.expire_in,
    };
  }

  /**
   * Refresh access_token pakai refresh_token. Dipanggil kalau access_token
   * mau expire (< 30 menit) atau sudah expire.
   */
  async refreshAccessToken(
    refreshToken: string,
    shopId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expireIn: number;
  }> {
    const { partnerId, partnerKey } = this.getPartnerCreds();
    const apiPath = "/api/v2/auth/access_token/get";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.signPublicApi(partnerId, partnerKey, apiPath, timestamp);

    const url = new URL(this.getBaseUrl() + apiPath);
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        shop_id: Number(shopId),
        partner_id: Number(partnerId),
      }),
    });
    const json = (await res.json()) as ShopeeTokenResponse;
    if (json.error) {
      throw new Error(
        `Shopee refresh gagal: ${json.error} — ${json.message ?? ""}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expireIn: json.expire_in,
    };
  }

  /**
   * GET shop info — dipakai setelah connect untuk fetch nama toko.
   */
  async getShopInfo(
    accessToken: string,
    shopId: string,
  ): Promise<{ shopName: string; status: string; region: string }> {
    const json = await this.callShopApi<{
      shop_name: string;
      status: string;
      region: string;
    }>(accessToken, shopId, "/api/v2/shop/get_shop_info", "GET");
    return {
      shopName: json.shop_name,
      status: json.status,
      region: json.region,
    };
  }

  /**
   * List item_id semua produk di shop. Paginated — caller harus loop pakai
   * `next_offset` sampai `has_next_page: false`.
   */
  async getItemList(
    accessToken: string,
    shopId: string,
    offset = 0,
    pageSize = 50,
  ): Promise<{
    items: Array<{ item_id: number; item_status: string }>;
    totalCount: number;
    hasNextPage: boolean;
    nextOffset: number;
  }> {
    const json = await this.callShopApi<{
      item: Array<{ item_id: number; item_status: string }>;
      total_count: number;
      has_next_page: boolean;
      next_offset: number;
    }>(
      accessToken,
      shopId,
      "/api/v2/product/get_item_list",
      "GET",
      undefined,
      {
        offset: String(offset),
        page_size: String(pageSize),
        item_status: "NORMAL", // alternatif: BANNED, UNLIST, SELLER_DELETE, REVIEWING
      },
    );
    return {
      items: json.item ?? [],
      totalCount: json.total_count ?? 0,
      hasNextPage: json.has_next_page ?? false,
      nextOffset: json.next_offset ?? 0,
    };
  }

  /**
   * Detail produk untuk N item_id (max 50 per call). Return harga, stok,
   * foto, dll. Caller harus chunk item_id list jadi 50-an.
   */
  async getItemBaseInfo(
    accessToken: string,
    shopId: string,
    itemIds: number[],
  ): Promise<ShopeeItemBaseInfo[]> {
    if (itemIds.length === 0) return [];
    const json = await this.callShopApi<{
      item_list: ShopeeItemBaseInfo[];
    }>(
      accessToken,
      shopId,
      "/api/v2/product/get_item_base_info",
      "GET",
      undefined,
      {
        item_id_list: itemIds.join(","),
      },
    );
    return json.item_list ?? [];
  }

  // ─── Internal helpers ────────────────────────────────────────────

  private signPublicApi(
    partnerId: string,
    partnerKey: string,
    apiPath: string,
    timestamp: number,
  ): string {
    const baseString = `${partnerId}${apiPath}${timestamp}`;
    return createHmac("sha256", partnerKey).update(baseString).digest("hex");
  }

  private signShopApi(
    partnerId: string,
    partnerKey: string,
    apiPath: string,
    timestamp: number,
    accessToken: string,
    shopId: string,
  ): string {
    const baseString = `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
    return createHmac("sha256", partnerKey).update(baseString).digest("hex");
  }

  /**
   * Wrapper untuk shop-level API: auto-inject signature + common params.
   * `extraQuery` dipakai untuk query string tambahan (mis. offset, item_id_list).
   * `body` untuk POST/PUT request.
   */
  private async callShopApi<T>(
    accessToken: string,
    shopId: string,
    apiPath: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    extraQuery?: Record<string, string>,
  ): Promise<T> {
    const { partnerId, partnerKey } = this.getPartnerCreds();
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.signShopApi(
      partnerId,
      partnerKey,
      apiPath,
      timestamp,
      accessToken,
      shopId,
    );

    const url = new URL(this.getBaseUrl() + apiPath);
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("shop_id", shopId);
    url.searchParams.set("sign", sign);
    if (extraQuery) {
      for (const [k, v] of Object.entries(extraQuery)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body && method === "POST"
        ? { body: JSON.stringify(body) }
        : {}),
    });
    const json = (await res.json()) as ShopeeApiResponse<T>;
    if (json.error) {
      this.logger.warn(
        `Shopee API ${apiPath} error: ${json.error} — ${json.message ?? ""}`,
      );
      throw new Error(
        `Shopee API ${apiPath}: ${json.error} — ${json.message ?? ""}`,
      );
    }
    return json.response;
  }
}

// ─── Types ────────────────────────────────────────────────────────

interface ShopeeApiResponse<T> {
  error?: string;
  message?: string;
  warning?: string;
  request_id?: string;
  response: T;
}

interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  error?: string;
  message?: string;
}

export interface ShopeeItemBaseInfo {
  item_id: number;
  item_name: string;
  item_sku?: string;
  item_status: string; // NORMAL | UNLIST | BANNED | SELLER_DELETE | REVIEWING
  category_id?: number;
  description?: string;
  has_model: boolean;
  image?: {
    image_url_list?: string[];
    image_id_list?: string[];
  };
  price_info?: Array<{
    currency: string;
    original_price: number;
    current_price: number;
  }>;
  stock_info_v2?: {
    summary_info?: {
      total_reserved_stock: number;
      total_available_stock: number;
    };
    seller_stock?: Array<{
      location_id?: string;
      stock: number;
    }>;
  };
  create_time?: number;
  update_time?: number;
  weight?: string;
}
