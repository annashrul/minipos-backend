import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthUser } from "@/contracts";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { MarketplaceShopeeService } from "./marketplace-shopee.service";

@Controller("marketplace/shopee")
export class MarketplaceShopeeController {
  constructor(private readonly service: MarketplaceShopeeService) {}

  /**
   * Return URL Shopee OAuth — frontend bisa redirect window.location ke
   * URL ini. Setelah user authorize, Shopee redirect ke /callback dengan
   * code + shop_id di query.
   */
  @Get("authorize-url")
  @UseGuards(AccessGuard)
  authorize(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("No company");
    // Pass companyId di state supaya callback (yang Public) tau owner-nya.
    // Encode minimal — companyId saja, signed dengan JWT-like atau sederhana
    // base64. Untuk simplicity sekarang pakai base64 + cek di callback.
    const state = Buffer.from(JSON.stringify({ c: user.companyId })).toString(
      "base64url",
    );
    const url = new URL(this.service.buildAuthorizeUrl());
    url.searchParams.set("state", state);
    return { data: { url: url.toString() } };
  }

  /**
   * Public callback dari Shopee — TIDAK pakai AccessGuard karena user
   * datang dari redirect Shopee tanpa JWT. Identitas company dibawa via
   * `state` param yang kita set di authorize-url.
   */
  @Get("callback")
  @Public()
  async callback(
    @Query("code") code: string,
    @Query("shop_id") shopId: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    const webOrigin =
      process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (!code || !shopId || !state) {
      return res.redirect(
        `${webOrigin}/integrations/shopee?error=missing_params`,
      );
    }
    let companyId: string | null = null;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      ) as { c?: string };
      companyId = decoded.c ?? null;
    } catch {
      // invalid state
    }
    if (!companyId) {
      return res.redirect(
        `${webOrigin}/integrations/shopee?error=invalid_state`,
      );
    }

    try {
      const result = await this.service.handleCallback(
        companyId,
        code,
        shopId,
      );
      return res.redirect(
        `${webOrigin}/integrations/shopee?connected=1&shop=${encodeURIComponent(result.shopName ?? shopId)}`,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? encodeURIComponent(err.message) : "unknown";
      return res.redirect(
        `${webOrigin}/integrations/shopee?error=${msg}`,
      );
    }
  }

  @Get("accounts")
  @UseGuards(AccessGuard)
  async listAccounts(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("No company");
    return { data: await this.service.listAccounts(user.companyId) };
  }

  @Delete("accounts/:id")
  @UseGuards(AccessGuard)
  async disconnect(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    await this.service.disconnect(user.companyId, id);
    return { data: { success: true } };
  }

  @Post("accounts/:id/products")
  @UseGuards(AccessGuard)
  async fetchProducts(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    return { data: await this.service.fetchProducts(user.companyId, id) };
  }

  /**
   * Connect via Playwright — backend buka Chromium di mesin yang jalankan
   * backend (= laptop user kalau dev lokal). User login manual, cookie
   * di-capture otomatis. HANYA WORKS untuk backend lokal.
   *
   * Long-running request (sampai 5 menit menunggu user login). Frontend
   * harus pakai timeout panjang & loading state.
   */
  @Post("connect-via-browser")
  @UseGuards(AccessGuard)
  async connectViaBrowser(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("No company");
    try {
      const result = await this.service.connectViaPlaywright(user.companyId);
      return { data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      // Common Playwright failures di server tanpa display:
      // - "Executable doesn't exist" — Chromium not installed (Docker image)
      // - "Missing X server" / "DISPLAY" — server tanpa GUI
      // - "Failed to launch browser process" — sandbox / permission issues
      if (
        /Executable doesn['']t exist|Missing X server|DISPLAY|Failed to launch browser|chromium-\d+\\chrome-/i.test(
          msg,
        )
      ) {
        throw new BadRequestException(
          "Fitur Connect via Browser hanya works di backend yang running lokal di laptop kamu. Untuk production / server, pakai opsi 'Paste Cookie Manual'.",
        );
      }
      throw err;
    }
  }

  /**
   * Connect via paste cookie session manual. User copy cookie dari DevTools
   * browser saat lagi login Shopee Seller, lalu paste ke form. Backend
   * verify cookie + save. Works di local maupun production.
   */
  @Post("connect-via-cookie")
  @UseGuards(AccessGuard)
  async connectViaCookie(
    @CurrentUser() user: AuthUser,
    @Body() body: { cookie?: string; userAgent?: string },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (!body.cookie || body.cookie.trim().length < 10) {
      throw new BadRequestException("Cookie kosong atau tidak valid");
    }
    const result = await this.service.connectViaCookie(
      user.companyId,
      body.cookie,
      body.userAgent ?? null,
    );
    return { data: result };
  }

  /**
   * Cek apakah cookie + tokens akun masih valid. Lightweight ping ke Shopee.
   */
  @Post("accounts/:id/verify")
  @UseGuards(AccessGuard)
  async verifyConnection(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    return {
      data: await this.service.verifyConnection(user.companyId, id),
    };
  }

  /**
   * Simpan anti-bot tokens (x-sap-ri, x-sap-sec, dll) untuk akun. Wajib
   * di-set sebelum push stok. Tokens expire ~15 menit s.d. beberapa jam,
   * user paste ulang saat dapat error 401 / token expired.
   */
  @Post("accounts/:id/scraping-tokens")
  @UseGuards(AccessGuard)
  async setScrapingTokens(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body()
    body: {
      xSapRi?: string;
      xSapSec?: string;
      afAcEncSzToken?: string;
      scFeSession?: string;
      scFeVer?: string;
    },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (!body.xSapRi || !body.xSapSec) {
      throw new BadRequestException("xSapRi dan xSapSec wajib di-isi");
    }
    await this.service.setScrapingTokens(user.companyId, id, {
      xSapRi: body.xSapRi,
      xSapSec: body.xSapSec,
      afAcEncSzToken: body.afAcEncSzToken,
      scFeSession: body.scFeSession,
      scFeVer: body.scFeVer,
    });
    return { data: { success: true } };
  }

  /**
   * List cached Shopee items dari DB. UI buka halaman call ini → instant.
   * Trigger fresh fetch via POST /accounts/:id/products.
   */
  @Get("accounts/:id/items")
  @UseGuards(AccessGuard)
  async listItems(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    return { data: await this.service.listCachedItems(user.companyId, id) };
  }

  /**
   * Link cached ShopeeItem ke produk MiniPOS.
   */
  @Post("items/:itemId/link")
  @UseGuards(AccessGuard)
  async linkItem(
    @CurrentUser() user: AuthUser,
    @Param("itemId") itemId: string,
    @Body() body: { productId?: string },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (!body.productId)
      throw new BadRequestException("productId wajib diisi");
    await this.service.linkShopeeItem(user.companyId, itemId, body.productId);
    return { data: { success: true } };
  }

  @Post("items/:itemId/unlink")
  @UseGuards(AccessGuard)
  async unlinkItem(
    @CurrentUser() user: AuthUser,
    @Param("itemId") itemId: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    await this.service.unlinkShopeeItem(user.companyId, itemId);
    return { data: { success: true } };
  }

  /**
   * Push stok untuk satu Shopee item (yang sudah ter-cache).
   * Body: { newStock }. Item harus sudah punya modelId valid.
   */
  @Post("items/:itemId/push-stock")
  @UseGuards(AccessGuard)
  async pushStock(
    @CurrentUser() user: AuthUser,
    @Param("itemId") itemId: string,
    @Body() body: { newStock?: number },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (typeof body.newStock !== "number")
      throw new BadRequestException("newStock wajib (angka)");
    return {
      data: await this.service.pushStockForItem(
        user.companyId,
        itemId,
        body.newStock,
      ),
    };
  }

  /**
   * Return semua productId yang punya link aktif ke Shopee item.
   * Frontend products list pakai ini buat decide row mana yg punya tombol.
   */
  @Get("linked-product-ids")
  @UseGuards(AccessGuard)
  async getLinkedProductIds(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("No company");
    return { data: await this.service.getLinkedProductIds(user.companyId) };
  }

  /**
   * Quick update stok: set BranchStock untuk satu cabang + push ke Shopee
   * sekaligus. Body: { branchId, newStock }.
   */
  @Post("products/:productId/quick-update-stock")
  @UseGuards(AccessGuard)
  async quickUpdateStock(
    @CurrentUser() user: AuthUser,
    @Param("productId") productId: string,
    @Body() body: { branchId?: string; newStock?: number },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (!body.branchId) throw new BadRequestException("branchId wajib");
    if (typeof body.newStock !== "number")
      throw new BadRequestException("newStock wajib (angka)");
    return {
      data: await this.service.quickUpdateStock({
        companyId: user.companyId,
        productId,
        branchId: body.branchId,
        newStock: body.newStock,
      }),
    };
  }

  /**
   * Cek apakah Product MiniPOS punya link aktif ke ShopeeItem.
   * UI product edit form pakai ini untuk show tombol "Push ke Shopee".
   */
  @Get("products/:productId/link-status")
  @UseGuards(AccessGuard)
  async getProductLinkStatus(
    @CurrentUser() user: AuthUser,
    @Param("productId") productId: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    return {
      data: await this.service.getProductLinkStatus(user.companyId, productId),
    };
  }

  /**
   * Push stok produk dari cabang tertentu ke Shopee.
   * Body: { branchId }. Backend lookup BranchStock + ShopeeItem yang linked.
   */
  @Post("products/:productId/push-stock-from-branch")
  @UseGuards(AccessGuard)
  async pushStockFromBranch(
    @CurrentUser() user: AuthUser,
    @Param("productId") productId: string,
    @Body() body: { branchId?: string },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    if (!body.branchId) throw new BadRequestException("branchId wajib");
    return {
      data: await this.service.pushStockFromBranch(
        user.companyId,
        productId,
        body.branchId,
      ),
    };
  }
}
