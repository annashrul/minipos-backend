import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { GrabScraperService } from "./grab-scraper.service";
import { MarketplaceGrabRepository } from "./marketplace-grab.repository";

type SaveAccountInput = {
  companyId: string;
  branchId?: string | null;
  cookie: string;
  userAgent?: string | null;
};

@Injectable()
export class MarketplaceGrabService {
  private readonly logger = new Logger(MarketplaceGrabService.name);

  constructor(
    private readonly repo: MarketplaceGrabRepository,
    private readonly scraper: GrabScraperService,
  ) {}

  /**
   * Verify cookie, derive merchantId, upsert GrabAccount. Kalau (companyId,
   * merchantId) sudah ada → update cookie & branchId.
   */
  async saveAccount(input: SaveAccountInput) {
    if (!input.cookie || input.cookie.length < 20) {
      throw new BadRequestException("Cookie tidak valid");
    }

    const profile = await this.scraper.verifyCookie(
      input.cookie,
      input.userAgent ?? null,
    );

    const account = await this.repo.upsertAccount(
      input.companyId,
      profile.merchantId,
      {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        merchantId: profile.merchantId,
        merchantName: profile.merchantName,
        cookie: input.cookie,
        cookieUserAgent: input.userAgent ?? null,
        isActive: true,
      },
      {
        branchId: input.branchId ?? null,
        merchantName: profile.merchantName ?? undefined,
        cookie: input.cookie,
        cookieUserAgent: input.userAgent ?? null,
        isActive: true,
        lastError: null,
      },
    );

    return account;
  }

  async listAccounts(companyId: string) {
    return this.repo.findManyAccounts(companyId);
  }

  async deleteAccount(companyId: string, accountId: string) {
    const account = await this.repo.findAccountByIdAndCompany(accountId, companyId);
    if (!account) throw new NotFoundException("Account tidak ditemukan");
    await this.repo.deleteAccount(accountId);
  }

  /**
   * Manual sync 1 account untuk rentang tanggal. Default: kemarin saja.
   * Dipakai oleh tombol "Sync Sekarang" di UI dan cron daily.
   */
  async syncAccount(
    accountId: string,
    opts?: { dateFrom?: string; dateTo?: string },
  ) {
    const account = await this.repo.findAccountById(accountId);
    if (!account) throw new NotFoundException("Account tidak ditemukan");
    if (!account.isActive) throw new BadRequestException("Account inactive");

    const yesterday = ymdJakarta(new Date(Date.now() - 86_400_000));
    const from = opts?.dateFrom ?? yesterday;
    const to = opts?.dateTo ?? yesterday;

    try {
      // 1. Daily summary
      const dailyRows = await this.scraper.fetchDailyReport(
        account.cookie,
        account.cookieUserAgent,
        account.merchantId,
        from,
        to,
      );

      for (const row of dailyRows) {
        if (!row.reportDate) continue;
        await this.repo.upsertDailyReport(
          account.id,
          new Date(row.reportDate),
          {
            accountId: account.id,
            reportDate: new Date(row.reportDate),
            orderCount: row.orderCount,
            completedCount: row.completedCount,
            cancelledCount: row.cancelledCount,
            grossSales: row.grossSales,
            netPayout: row.netPayout,
            commission: row.commission,
            refundAmount: row.refundAmount,
            rawPayload: row.raw as object,
          },
          {
            orderCount: row.orderCount,
            completedCount: row.completedCount,
            cancelledCount: row.cancelledCount,
            grossSales: row.grossSales,
            netPayout: row.netPayout,
            commission: row.commission,
            refundAmount: row.refundAmount,
            rawPayload: row.raw as object,
            fetchedAt: new Date(),
          },
        );
      }

      // 2. Detail orders
      const orderRows = await this.scraper.fetchOrders(
        account.cookie,
        account.cookieUserAgent,
        account.merchantId,
        from,
        to,
      );

      for (const o of orderRows) {
        if (!o.grabOrderId) continue;
        await this.repo.upsertOrder(
          account.id,
          o.grabOrderId,
          {
            accountId: account.id,
            grabOrderId: o.grabOrderId,
            shortOrderId: o.shortOrderId,
            customerName: o.customerName,
            customerPhone: o.customerPhone,
            subtotal: o.subtotal,
            deliveryFee: o.deliveryFee,
            discount: o.discount,
            total: o.total,
            commission: o.commission,
            netPayout: o.netPayout,
            status: o.status,
            paymentMethod: o.paymentMethod,
            cancelReason: o.cancelReason,
            items: (o.items as object) ?? undefined,
            itemCount: o.itemCount,
            orderedAt: o.orderedAt,
            acceptedAt: o.acceptedAt,
            readyAt: o.readyAt,
            pickedUpAt: o.pickedUpAt,
            deliveredAt: o.deliveredAt,
            cancelledAt: o.cancelledAt,
            rawPayload: o.raw as object,
          },
          {
            status: o.status,
            cancelReason: o.cancelReason,
            commission: o.commission,
            netPayout: o.netPayout,
            deliveredAt: o.deliveredAt,
            cancelledAt: o.cancelledAt,
            rawPayload: o.raw as object,
            fetchedAt: new Date(),
          },
        );
      }

      await this.repo.updateAccountSync(account.id, {
        lastSyncedAt: new Date(),
        lastError: null,
      });

      return {
        ok: true,
        dailyRows: dailyRows.length,
        orderRows: orderRows.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[grab sync] account=${account.id} failed: ${msg}`);
      await this.repo.updateAccountSync(account.id, {
        lastError: msg.slice(0, 500),
      });
      throw err;
    }
  }

  /**
   * Sync semua account aktif (dipanggil cron). Tidak throw — collect error
   * per account & return summary.
   */
  async syncAllActive() {
    const accounts = await this.repo.findAllActiveAccounts();
    const results: Array<{
      accountId: string;
      ok: boolean;
      error?: string;
      dailyRows?: number;
      orderRows?: number;
    }> = [];
    for (const a of accounts) {
      try {
        const r = await this.syncAccount(a.id);
        results.push({
          accountId: a.id,
          ok: true,
          dailyRows: r.dailyRows,
          orderRows: r.orderRows,
        });
      } catch (err) {
        results.push({
          accountId: a.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  /**
   * List daily reports untuk halaman dashboard. Filter optional by date range
   * + accountId.
   */
  async listDailyReports(
    companyId: string,
    opts?: {
      accountId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    },
  ) {
    return this.repo.findManyDailyReports(
      {
        account: { companyId },
        ...(opts?.accountId ? { accountId: opts.accountId } : {}),
        ...(opts?.dateFrom || opts?.dateTo
          ? {
              reportDate: {
                ...(opts.dateFrom ? { gte: new Date(opts.dateFrom) } : {}),
                ...(opts.dateTo ? { lte: new Date(opts.dateTo) } : {}),
              },
            }
          : {}),
      },
      opts?.limit ?? 90,
    );
  }

  async listOrders(
    companyId: string,
    opts?: {
      accountId?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    return this.repo.findManyOrders(
      {
        account: { companyId },
        ...(opts?.accountId ? { accountId: opts.accountId } : {}),
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.dateFrom || opts?.dateTo
          ? {
              orderedAt: {
                ...(opts.dateFrom ? { gte: new Date(opts.dateFrom) } : {}),
                ...(opts.dateTo ? { lte: new Date(opts.dateTo) } : {}),
              },
            }
          : {}),
      },
      opts?.limit ?? 100,
      opts?.cursor,
    );
  }
}

/**
 * Format Date jadi YYYY-MM-DD untuk timezone Asia/Jakarta (UTC+7).
 * Penting karena Grab Merchant Portal report di-aggregate per hari WIB,
 * bukan UTC.
 */
function ymdJakarta(d: Date): string {
  const jakartaMs = d.getTime() + 7 * 3600 * 1000;
  const jd = new Date(jakartaMs);
  const y = jd.getUTCFullYear();
  const m = String(jd.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jd.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
