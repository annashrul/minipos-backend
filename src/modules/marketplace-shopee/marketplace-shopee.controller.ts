import {
  BadRequestException,
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
    const result = await this.service.connectViaPlaywright(user.companyId);
    return { data: result };
  }
}
