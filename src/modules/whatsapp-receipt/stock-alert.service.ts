import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { WhatsappMessageService } from "./whatsapp-message.service";

/** Stok di bawah ambang ini dianggap kritis → kirim WA. */
const CRITICAL_THRESHOLD = 2; // stok < 2 (yaitu 0 atau 1)
/** Cooldown per produk supaya tidak spam WA tiap mutasi. */
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 jam

/**
 * Kirim notifikasi WhatsApp otomatis (best-effort) ke admin saat stok suatu
 * produk turun di bawah ambang kritis (< 2). Tidak memblok alur utama —
 * dipanggil fire-and-forget dari titik mutasi stok (adjust, checkout).
 */
@Injectable()
export class StockAlertService {
  private readonly logger = new Logger(StockAlertService.name);
  private readonly lastNotified = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WhatsappMessageService,
  ) {}

  /** Fire-and-forget: cek & kirim alert untuk produk2 di cabang ini. */
  notifyCriticalStock(
    companyId: string,
    branchId: string | null | undefined,
    productIds: string[],
  ): void {
    if (!branchId || !productIds.length) return;
    void this.run(companyId, branchId, productIds).catch((e) =>
      this.logger.warn(
        `[stock-alert] gagal: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  private async run(
    companyId: string,
    branchId: string,
    productIds: string[],
  ): Promise<void> {
    const rows = await this.prisma.branchStock.findMany({
      where: {
        branchId,
        productId: { in: productIds },
        quantity: { lt: CRITICAL_THRESHOLD },
      },
      select: {
        productId: true,
        quantity: true,
        product: { select: { name: true, code: true } },
        branch: { select: { name: true } },
      },
    });
    if (!rows.length) return;

    // Penerima: nomor admin perusahaan.
    const admin = await this.prisma.user.findFirst({
      where: {
        companyId,
        role: { in: ["SUPER_ADMIN", "ADMIN"] },
        phone: { not: null },
      },
      select: { phone: true },
    });
    const phone = admin?.phone;
    if (!phone) {
      this.logger.warn("[stock-alert] tidak ada nomor admin — lewati");
      return;
    }

    const now = Date.now();
    for (const r of rows) {
      const key = `${companyId}:${branchId}:${r.productId}`;
      if (now - (this.lastNotified.get(key) ?? 0) < COOLDOWN_MS) continue;
      this.lastNotified.set(key, now);

      const msg =
        `⚠️ *Stok Kritis*\n` +
        `${r.product?.name ?? "Produk"} (${r.product?.code ?? "-"})\n` +
        `Sisa: *${r.quantity}* di ${r.branch?.name ?? "cabang"}.\n` +
        `Segera lakukan restock.`;
      try {
        await this.wa.sendText(companyId, phone, msg);
        this.logger.log(
          `[stock-alert] terkirim: ${r.product?.code} (sisa ${r.quantity}) -> ${phone}`,
        );
      } catch (e) {
        // best-effort: WA belum di-setup / nomor tak valid → cukup log.
        this.logger.warn(
          `[stock-alert] WA gagal (${r.product?.code}): ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }
}
