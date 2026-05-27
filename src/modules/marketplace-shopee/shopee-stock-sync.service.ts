import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ShopeeScraperService,
  type ScrapingTokens,
} from "./shopee-scraper.service";
import { MarketplaceShopeeRepository } from "./marketplace-shopee.repository";

/**
 * Handles all stock push operations to Shopee: quick update, push from
 * branch, push for a single ShopeeItem, and push via marketplace mapping.
 */
@Injectable()
export class ShopeeStockSyncService {
  private readonly logger = new Logger(ShopeeStockSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MarketplaceShopeeRepository,
    private readonly scraper: ShopeeScraperService,
  ) {}

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
      this.repo.findProductByIdAndCompany(productId, companyId, { id: true }),
      this.repo.findBranchByIdAndCompany(branchId, companyId),
    ]);
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");

    // 1) Update BranchStock di MiniPOS.
    await this.repo.upsertBranchStock(branchId, productId, safeStock, 5);
    // Note: DB trigger akan auto-sync Product.stock = SUM(BranchStock).

    // 2) Push ke Shopee — best effort. Kalau gagal, MiniPOS update tetap
    // tersimpan, hanya report bahwa Shopee belum sinkron.
    const shopeeItem = await this.repo.findShopeeItemByProduct(productId, companyId);
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
    const item = await this.repo.findShopeeItemByProduct(productId, companyId);
    if (!item) {
      throw new BadRequestException(
        "Produk ini belum ter-link dengan item Shopee. Sync Shopee dulu.",
      );
    }
    // 2) Lookup BranchStock untuk cabang tsb.
    const bs = await this.repo.findBranchStock(branchId, productId);
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

    const item = await this.repo.findShopeeItemForPush(shopeeItemId, companyId);
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
      await this.repo.updateAccount(account.id, { lastError: msg });
      throw err;
    }

    const now = new Date();
    await this.repo.updateShopeeItem(shopeeItemId, { totalStock: safeStock, lastPushedAt: now });
    await this.repo.updateAccount(account.id, { lastSyncedAt: now, lastError: null });

    return { pushedAt: now.toISOString(), newStock: safeStock };
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
