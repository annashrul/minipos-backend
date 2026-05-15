import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MarketplaceGrabService } from "./marketplace-grab.service";

/**
 * Daily cron — pull data Grab kemarin (jam 01:00 WIB supaya hari sebelumnya
 * sudah pasti complete dari sisi Grab settlement). Kalau dijalankan ulang
 * di hari yg sama, upsert idempotent — aman.
 */
@Injectable()
export class MarketplaceGrabCronService {
  private readonly logger = new Logger(MarketplaceGrabCronService.name);

  constructor(private readonly service: MarketplaceGrabService) {}

  @Cron("0 1 * * *", { timeZone: "Asia/Jakarta", name: "grab-daily-sync" })
  async runDailySync(): Promise<void> {
    this.logger.log("[grab cron] tick — sync semua active account");
    const results = await this.service.syncAllActive();
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    this.logger.log(
      `[grab cron] selesai: ${ok} sukses, ${fail} gagal dari ${results.length} account`,
    );
    if (fail > 0) {
      for (const r of results) {
        if (!r.ok) {
          this.logger.warn(`[grab cron] account=${r.accountId} err=${r.error}`);
        }
      }
    }
  }

  /**
   * Manual trigger untuk testing dari admin panel — bypass jadwal cron.
   */
  async triggerNow() {
    return this.service.syncAllActive();
  }
}
