import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";

/**
 * Scraper untuk Grab Merchant Portal internal API.
 *
 * PoC — read-only, daily reporting saja. JANGAN dipakai untuk real-time
 * action (accept order, mark ready, dll) — pakai Grab Partner API resmi
 * untuk itu. Risk yang lebih besar dari Shopee scraper:
 * - Anti-bot Akamai-style (TLS fingerprint, JS challenge)
 * - Token refresh window 1-4 jam
 * - IP datacenter (Cloud Run/AWS) sering di-block
 *
 * Pakai untuk: in-house tool, 1x sehari cron pull sales summary +
 * historical order detail. Kalau di-flag, akun tetap aman karena
 * pattern manusia (1x sehari, bukan polling rapat).
 *
 * ENDPOINT BELUM DIKETAHUI — user perlu inspect DevTools dari
 * merchant.grab.com dan share sample request/response. Methods di
 * service ini sudah punya pattern HTTP yang siap, tinggal isi URL
 * + parse logic di tempat TODO.
 */
@Injectable()
export class GrabScraperService {
  private readonly logger = new Logger(GrabScraperService.name);

  // Web portal (asal browser merchant) — dipakai di Referer/Origin header.
  private readonly WEB = "https://merchant.grab.com";
  // API host — endpoint actual yang berbalas data.
  private readonly API = "https://api.grab.com";

  private readonly DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

  /**
   * Verify cookie valid dengan call endpoint ringan (mis. /me atau /profile).
   * Return merchant info dasar.
   *
   * TODO: ganti URL & parse response sesuai endpoint Grab Merchant Portal.
   */
  async verifyCookie(
    cookie: string,
    userAgent: string | null,
  ): Promise<{ merchantId: string; merchantName: string | null }> {
    if (!cookie) throw new BadRequestException("Cookie session kosong");

    const ua = userAgent || this.DEFAULT_UA;
    // Real endpoint Grab Merchant Web Portal — di-confirm via curl real dari
    // browser merchant Indonesia (15 Mei 2026):
    //   GET https://api.grab.com/mex-app/troy/user-profile/v2/details
    const url = `${this.API}/mex-app/troy/user-profile/v2/details`;

    const res = await this.request(url, { cookie, userAgent: ua });
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(
        "Cookie session Grab expired / invalid. Silakan paste cookie baru dari browser merchant Grab.",
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new BadGatewayException(
        `Grab verifyCookie HTTP ${res.status}: ${txt.slice(0, 200)}`,
      );
    }

    const json = (await res.json().catch(() => null)) as GrabProfileResponse | null;
    // Field name di endpoint ini belum 100% confirmed — kemungkinan:
    // - root: userID, name, email, merchantID, displayName
    // - nested: data.merchantID / data.userID
    // Fallback chain — pakai yang ada.
    const dataNode = json?.data ?? json ?? {};
    const merchantId =
      dataNode.merchantID ??
      dataNode.merchantId ??
      dataNode.userID ??
      dataNode.userId ??
      dataNode.id ??
      "";
    const merchantName =
      dataNode.merchantName ??
      dataNode.displayName ??
      dataNode.name ??
      dataNode.email ??
      null;
    if (!merchantId) {
      throw new BadRequestException(
        `Grab profile response tidak punya merchantID/userID. Response keys: ${Object.keys(dataNode).slice(0, 20).join(", ") || "(empty)"}. Cek field mapping di GrabScraperService.verifyCookie.`,
      );
    }
    return {
      merchantId: String(merchantId),
      merchantName: merchantName ? String(merchantName) : null,
    };
  }

  /**
   * Pull daily summary (orderCount, GMV, payout, refund) untuk rentang
   * tanggal. Untuk daily cron, panggil dengan dateFrom = dateTo = yesterday.
   *
   * TODO: ganti URL & parsing sesuai endpoint summary Grab Merchant Portal.
   * Kemungkinan endpoint: /api/merchant/reports/daily, /api/v1/sales/summary,
   * /api/merchant/finance/dashboard, dll.
   */
  async fetchDailyReport(
    cookie: string,
    userAgent: string | null,
    merchantId: string,
    dateFrom: string, // YYYY-MM-DD
    dateTo: string, // YYYY-MM-DD
  ): Promise<GrabDailyReportRow[]> {
    const ua = userAgent || this.DEFAULT_UA;
    // TODO: replace dengan endpoint actual setelah inspect dari Network tab.
    // Kemungkinan host & path mirip pola profile: api.grab.com/mex-app/...
    const url = new URL(`${this.API}/mex-app/troy/reports/daily`);
    url.searchParams.set("merchantID", merchantId);
    url.searchParams.set("from", dateFrom);
    url.searchParams.set("to", dateTo);

    const res = await this.request(url.toString(), { cookie, userAgent: ua });
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(
        "Cookie Grab expired. Paste ulang cookie.",
      );
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new BadGatewayException(
        `Grab dailyReport HTTP ${res.status}: ${txt.slice(0, 200)}`,
      );
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: { rows?: GrabDailyReportRaw[] } }
      | null;
    const rows = json?.data?.rows ?? [];

    if (rows[0]) {
      this.logger.log(
        `[grab scraper] sample daily row: ${JSON.stringify(rows[0]).slice(0, 1000)}`,
      );
    }

    return rows.map((r) => this.normalizeDaily(r));
  }

  /**
   * Pull list order di rentang tanggal — completed/cancelled only. Loop
   * pagination sampai habis.
   *
   * TODO: ganti URL & parsing sesuai endpoint order list Grab Merchant Portal.
   */
  async fetchOrders(
    cookie: string,
    userAgent: string | null,
    merchantId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<GrabOrderRow[]> {
    const ua = userAgent || this.DEFAULT_UA;
    const PAGE_SIZE = 50;
    const MAX_PAGES = 100; // safety cap (5000 orders/day)
    const aggregated: GrabOrderRaw[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      // TODO: replace endpoint actual setelah inspect dari Network tab.
      const url = new URL(`${this.API}/mex-app/troy/orders`);
      url.searchParams.set("merchantID", merchantId);
      url.searchParams.set("from", dateFrom);
      url.searchParams.set("to", dateTo);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(PAGE_SIZE));

      const res = await this.request(url.toString(), { cookie, userAgent: ua });
      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException(
          "Cookie Grab expired. Paste ulang cookie.",
        );
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new BadGatewayException(
          `Grab orders HTTP ${res.status}: ${txt.slice(0, 200)}`,
        );
      }
      const json = (await res.json().catch(() => null)) as
        | { data?: { orders?: GrabOrderRaw[]; total?: number } }
        | null;
      const pageItems = json?.data?.orders ?? [];
      if (pageItems.length === 0) break;

      if (page === 1 && pageItems[0]) {
        this.logger.log(
          `[grab scraper] sample order: ${JSON.stringify(pageItems[0]).slice(0, 2000)}`,
        );
      }

      aggregated.push(...pageItems);
      if (pageItems.length < PAGE_SIZE) break;
    }

    return aggregated.map((o) => this.normalizeOrder(o));
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private async request(
    url: string,
    opts: { cookie: string; userAgent: string },
  ): Promise<Response> {
    return fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "accept-language": "id-ID,id;q=0.9,en-GB;q=0.8,en;q=0.7,en-US;q=0.6",
        cookie: opts.cookie,
        lang: "ID",
        origin: this.WEB,
        referer: `${this.WEB}/`,
        "user-agent": opts.userAgent,
        // Header identifier yang Grab Merchant Web Portal pakai — confirmed
        // dari curl real. Tanpa ini request bisa di-reject dengan 401/403.
        "x-client-id": "GrabMerchant-Portal",
        "x-grabkit-clientid": "GrabMerchant-Portal",
      },
    });
  }

  /**
   * Normalisasi response Grab → shape internal kita.
   * TODO: sesuaikan field mapping setelah dapat sample response asli.
   */
  private normalizeDaily(raw: GrabDailyReportRaw): GrabDailyReportRow {
    return {
      reportDate: String(raw.date ?? raw.reportDate ?? ""),
      orderCount: Number(raw.orderCount ?? raw.totalOrders ?? 0),
      completedCount: Number(raw.completedCount ?? raw.completed ?? 0),
      cancelledCount: Number(raw.cancelledCount ?? raw.cancelled ?? 0),
      grossSales: Math.round(Number(raw.grossSales ?? raw.gmv ?? 0)),
      netPayout: Math.round(Number(raw.netPayout ?? raw.payout ?? 0)),
      commission: Math.round(Number(raw.commission ?? raw.grabFee ?? 0)),
      refundAmount: Math.round(Number(raw.refundAmount ?? raw.refund ?? 0)),
      raw,
    };
  }

  private normalizeOrder(raw: GrabOrderRaw): GrabOrderRow {
    return {
      grabOrderId: String(raw.orderID ?? raw.orderId ?? raw.id ?? ""),
      shortOrderId: raw.shortOrderID ?? raw.displayID ?? null,
      customerName: raw.customer?.name ?? raw.customerName ?? null,
      customerPhone: raw.customer?.phone ?? raw.customerPhone ?? null,
      subtotal: Math.round(Number(raw.subtotal ?? 0)),
      deliveryFee: Math.round(Number(raw.deliveryFee ?? raw.delivery_fee ?? 0)),
      discount: Math.round(Number(raw.discount ?? 0)),
      total: Math.round(Number(raw.total ?? raw.totalAmount ?? 0)),
      commission: Math.round(Number(raw.commission ?? raw.grabFee ?? 0)),
      netPayout: Math.round(Number(raw.netPayout ?? raw.payout ?? 0)),
      status: String(raw.state ?? raw.status ?? "COMPLETED").toUpperCase(),
      paymentMethod: raw.paymentMethod ?? raw.payment ?? null,
      cancelReason: raw.cancelReason ?? raw.reason ?? null,
      items: raw.items ?? raw.lineItems ?? null,
      itemCount: Array.isArray(raw.items)
        ? raw.items.length
        : Array.isArray(raw.lineItems)
          ? raw.lineItems.length
          : 0,
      orderedAt: parseDate(raw.createdAt ?? raw.orderedAt),
      acceptedAt: parseDate(raw.acceptedAt),
      readyAt: parseDate(raw.readyAt),
      pickedUpAt: parseDate(raw.pickedUpAt),
      deliveredAt: parseDate(raw.deliveredAt ?? raw.completedAt),
      cancelledAt: parseDate(raw.cancelledAt),
      raw,
    };
  }
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────
// Types — internal normalized shape (returned to service)
// ─────────────────────────────────────────────────────────────────

export type GrabDailyReportRow = {
  reportDate: string; // YYYY-MM-DD
  orderCount: number;
  completedCount: number;
  cancelledCount: number;
  grossSales: number;
  netPayout: number;
  commission: number;
  refundAmount: number;
  raw: unknown;
};

export type GrabOrderRow = {
  grabOrderId: string;
  shortOrderId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  commission: number;
  netPayout: number;
  status: string;
  paymentMethod: string | null;
  cancelReason: string | null;
  items: unknown;
  itemCount: number;
  orderedAt: Date | null;
  acceptedAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  raw: unknown;
};

// Profile endpoint response — field-name longgar karena Grab punya banyak
// versi (mex-app/troy/user-profile/v2). Parser pakai fallback chain.
type GrabProfileResponse = {
  data?: {
    merchantID?: string;
    merchantId?: string;
    merchantName?: string;
    displayName?: string;
    userID?: string;
    userId?: string;
    id?: string;
    name?: string;
    email?: string;
    [k: string]: unknown;
  };
  // Beberapa endpoint Grab return field langsung di root tanpa `data` wrapper.
  merchantID?: string;
  merchantId?: string;
  merchantName?: string;
  displayName?: string;
  userID?: string;
  userId?: string;
  id?: string;
  name?: string;
  email?: string;
  [k: string]: unknown;
};

// Raw shape (loose) — Grab API field name belum confirmed; fallback chain
// di normalize-er ambil yang ada.
type GrabDailyReportRaw = {
  date?: string;
  reportDate?: string;
  orderCount?: number;
  totalOrders?: number;
  completedCount?: number;
  completed?: number;
  cancelledCount?: number;
  cancelled?: number;
  grossSales?: number;
  gmv?: number;
  netPayout?: number;
  payout?: number;
  commission?: number;
  grabFee?: number;
  refundAmount?: number;
  refund?: number;
  [k: string]: unknown;
};

type GrabOrderRaw = {
  orderID?: string;
  orderId?: string;
  id?: string;
  shortOrderID?: string;
  displayID?: string;
  customer?: { name?: string; phone?: string };
  customerName?: string;
  customerPhone?: string;
  subtotal?: number;
  deliveryFee?: number;
  delivery_fee?: number;
  discount?: number;
  total?: number;
  totalAmount?: number;
  commission?: number;
  grabFee?: number;
  netPayout?: number;
  payout?: number;
  state?: string;
  status?: string;
  paymentMethod?: string;
  payment?: string;
  cancelReason?: string;
  reason?: string;
  items?: unknown[];
  lineItems?: unknown[];
  createdAt?: string;
  orderedAt?: string;
  acceptedAt?: string;
  readyAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  [k: string]: unknown;
};
