import { Injectable, Logger } from "@nestjs/common";
import { chromium, type Browser, type BrowserContext } from "playwright";

/**
 * Helper Playwright untuk Shopee login. Buka Chromium di laptop user
 * (backend running locally), tunggu user login manual di window itu,
 * lalu extract cookie session + return ke caller untuk disimpan.
 *
 * KETERBATASAN PENTING:
 * - HANYA jalan kalau backend running di MESIN YANG SAMA dengan user.
 *   Kalau backend di Cloud Run/server remote, Chromium akan launch di
 *   server (yang headless tanpa display), bukan di laptop user — flow
 *   ini gagal total.
 * - Login Shopee mungkin trigger anti-bot challenge (captcha/email OTP)
 *   karena Playwright detect-able. User wajib solve manual di window itu.
 * - Single concurrent login per backend instance — kalau 2 user trigger
 *   bersamaan, request kedua antri (lock di-prevent ke depan).
 */
@Injectable()
export class ShopeePlaywrightService {
  private readonly logger = new Logger(ShopeePlaywrightService.name);

  // URL yang menandakan user sudah login sukses (redirect dari /login ke
  // dashboard). Cek URL contains pattern ini.
  private readonly LOGIN_URL = "https://seller.shopee.co.id/account/signin";
  private readonly SUCCESS_URL_PATTERNS = [
    /seller\.shopee\.co\.id\/portal/,
    /seller\.shopee\.co\.id\/datacenter/,
    /seller\.shopee\.co\.id\/(?!account\/signin)/,
  ];

  private readonly LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit

  /**
   * Launch browser, navigate ke Shopee login, tunggu user complete login,
   * return cookie string + user-agent. Throw kalau timeout / user close
   * browser tanpa login.
   */
  async openLoginAndCaptureCookies(): Promise<{
    cookieString: string;
    userAgent: string;
  }> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      this.logger.log("[shopee-playwright] launching Chromium...");
      browser = await chromium.launch({
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
        ],
      });
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        locale: "id-ID",
      });

      // Stealth-ish: hide webdriver flag yang Playwright bocorin by default.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      const page = await context.newPage();
      await page.goto(this.LOGIN_URL, { waitUntil: "domcontentloaded" });

      this.logger.log(
        "[shopee-playwright] menunggu user login (max 5 menit)...",
      );

      // Polling URL — Playwright `waitForURL` regex tidak fleksibel cukup,
      // kita poll setiap 500ms sampai URL match success pattern atau timeout.
      const startedAt = Date.now();
      let loggedIn = false;
      while (Date.now() - startedAt < this.LOGIN_TIMEOUT_MS) {
        const url = page.url();
        if (this.SUCCESS_URL_PATTERNS.some((re) => re.test(url))) {
          // Extra wait — pastikan session cookies sudah ke-set
          // (Shopee suka set cookie via JS setelah redirect).
          await page.waitForTimeout(2000);
          loggedIn = true;
          break;
        }
        // Detect kalau page sudah ditutup oleh user
        if (page.isClosed()) {
          throw new Error("Browser ditutup oleh user sebelum login selesai");
        }
        await page.waitForTimeout(500);
      }

      if (!loggedIn) {
        throw new Error(
          "Login timeout — user tidak menyelesaikan login dalam 5 menit",
        );
      }

      // Extract cookies dari context (semua cookies untuk shopee.co.id).
      const cookies = await context.cookies();
      const shopeeCookies = cookies.filter((c) =>
        c.domain.includes("shopee.co.id"),
      );

      // Pastikan ada cookie penting (SPC_CDS untuk anti-CSRF + SPC_U untuk user_id).
      const hasSpcCds = shopeeCookies.some((c) => c.name === "SPC_CDS");
      const hasSpcU = shopeeCookies.some((c) => c.name === "SPC_U");
      if (!hasSpcCds || !hasSpcU) {
        throw new Error(
          "Login berhasil tapi cookie session tidak lengkap. Coba ulangi.",
        );
      }

      const cookieString = shopeeCookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      const userAgent = await page.evaluate(() => navigator.userAgent);

      this.logger.log(
        `[shopee-playwright] login berhasil — ${shopeeCookies.length} cookies captured`,
      );

      return { cookieString, userAgent };
    } finally {
      // Cleanup — pastikan browser always closed.
      try {
        await context?.close();
      } catch {
        /* noop */
      }
      try {
        await browser?.close();
      } catch {
        /* noop */
      }
    }
  }
}
