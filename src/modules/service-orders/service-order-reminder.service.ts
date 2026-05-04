import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappReceiptService } from "../whatsapp-receipt/whatsapp-receipt.service";
import { PLATFORM_WA_SENDER_ID } from "../auth/current-company.decorator";

/**
 * Window reminder service: H-7 dan H-3 sebelum tanggal `nextServiceAt`.
 * Cron jalan tiap hari jam 09:00 WIB (Asia/Jakarta) supaya pesan sampai di
 * jam aktif customer.
 *
 * Idempoten via field `lastReminderSentAt` — sekali dikirim untuk satu
 * window, tidak dikirim lagi sampai window berubah (mis. H-7 → H-3).
 */
@Injectable()
export class ServiceOrderReminderService {
  private readonly logger = new Logger(ServiceOrderReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waReceipt: WhatsappReceiptService,
  ) {}

  @Cron("0 9 * * *", { timeZone: "Asia/Jakarta", name: "so-reminder-daily" })
  async runDailyReminder(): Promise<void> {
    this.logger.log("[so-reminder] cron tick — scanning service orders");
    await this.processWindow(7);
    await this.processWindow(3);
  }

  /**
   * Manual trigger — dipakai untuk testing dari admin panel atau saat
   * deploy supaya bisa langsung dicek tanpa nunggu cron jam 9.
   */
  async triggerNow(): Promise<{ scanned: number; sent: number; failed: number }> {
    const r1 = await this.processWindow(7);
    const r2 = await this.processWindow(3);
    return {
      scanned: r1.scanned + r2.scanned,
      sent: r1.sent + r2.sent,
      failed: r1.failed + r2.failed,
    };
  }

  private async processWindow(daysAhead: number): Promise<{ scanned: number; sent: number; failed: number }> {
    // Window 1 hari penuh dari awal sampai akhir tanggal target.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetStart = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);

    // Cari SO DIBAYAR dengan nextServiceAt jatuh di window ini, dan belum
    // di-reminder hari ini (lastReminderSentAt < hari ini).
    const sos = await this.prisma.serviceOrder.findMany({
      where: {
        status: "DIBAYAR",
        nextServiceAt: { gte: targetStart, lt: targetEnd },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: today } },
        ],
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicle: {
          select: {
            plateNumber: true,
            brand: { select: { name: true } },
            modelRef: { select: { name: true } },
          },
        },
        // ServiceOrder hanya punya companyId (string), tidak ada relasi langsung.
        // Ambil nama company via Branch.company yang sudah ter-relasi.
        branch: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
      take: 200, // batch limit per window per run
    });

    if (sos.length === 0) {
      this.logger.log(`[so-reminder] window H-${daysAhead}: no candidates`);
      return { scanned: 0, sent: 0, failed: 0 };
    }

    // Pengirim: WA platform-owner (companyId = PLATFORM_WA_SENDER_ID).
    const senderSession = await this.prisma.whatsappSession.findFirst({
      where: { companyId: PLATFORM_WA_SENDER_ID },
      select: { companyId: true, status: true },
    });
    if (!senderSession || senderSession.status !== "CONNECTED") {
      this.logger.warn(
        `[so-reminder] platform WA sender not connected (status=${senderSession?.status ?? "missing"}), skipping ${sos.length} reminders`,
      );
      return { scanned: sos.length, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    for (const so of sos) {
      const phone = so.customer?.phone;
      if (!phone || !so.nextServiceAt) {
        // Tandai supaya tidak dipindai berulang kali.
        await this.prisma.serviceOrder.update({
          where: { id: so.id },
          data: { lastReminderSentAt: new Date() },
        });
        continue;
      }

      const msg = this.buildMessage({
        storeName: so.branch?.company?.name ?? "Bengkel",
        customerName: so.customer?.name ?? "Pelanggan",
        plate: so.vehicle?.plateNumber ?? "-",
        brand: so.vehicle?.brand?.name ?? "",
        model: so.vehicle?.modelRef?.name ?? "",
        nextServiceAt: so.nextServiceAt,
        daysAhead,
      });

      try {
        await this.waReceipt.sendText(senderSession.companyId, phone, msg);
        await this.prisma.serviceOrder.update({
          where: { id: so.id },
          data: { lastReminderSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        failed++;
        this.logger.error(
          `[so-reminder] failed sending to ${phone} for SO ${so.orderNumber}: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    this.logger.log(
      `[so-reminder] window H-${daysAhead}: scanned=${sos.length} sent=${sent} failed=${failed}`,
    );
    return { scanned: sos.length, sent, failed };
  }

  private buildMessage(params: {
    storeName: string;
    customerName: string;
    plate: string;
    brand: string;
    model: string;
    nextServiceAt: Date;
    daysAhead: number;
  }): string {
    const dateStr = params.nextServiceAt.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });
    const vehicle = [params.brand, params.model].filter(Boolean).join(" ");
    const vehicleDesc = vehicle ? `${params.plate} (${vehicle})` : params.plate;

    return (
      `Halo ${params.customerName} 👋\n\n` +
      `Pengingat dari *${params.storeName}*: kendaraan Anda *${vehicleDesc}* ` +
      `disarankan service berikutnya pada *${dateStr}* (sekitar ${params.daysAhead} hari lagi).\n\n` +
      `Booking sekarang untuk dapat slot mekanik dan harga terbaik. ` +
      `Balas pesan ini kalau mau dijadwalkan.\n\n` +
      `Terima kasih sudah service di ${params.storeName} 🛠️`
    );
  }
}
