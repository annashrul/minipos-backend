import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EmailService } from "./email.service";
import { buildReceiptHtml } from "./receipt-template";
import type { EmailReceiptDto } from "./dto/email.dto";

/**
 * Kirim struk transaksi (by id) sebagai email HTML. Mengambil transaksi +
 * konfigurasi toko dari DB (sumber kebenaran) lalu merakit struk via
 * `buildReceiptHtml`. Dipakai dari halaman Riwayat Transaksi.
 */
@Injectable()
export class ReceiptEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async sendForTransaction(
    companyId: string,
    transactionId: string,
    to: string,
  ): Promise<{ id: string }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        user: { select: { name: true } },
        customer: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }

    // Item JASA ad-hoc (tanpa productId) disimpan di ServiceOrder, bukan
    // TransactionItem — ambil dari sana bila transaksi berasal dari SO.
    const serviceOrder = await this.prisma.serviceOrder.findUnique({
      where: { transactionId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });

    const items = serviceOrder
      ? serviceOrder.items.map((it) => ({
          name: it.name,
          qty: it.quantity,
          price: it.unitPrice,
          subtotal: it.subtotal,
        }))
      : transaction.items.map((it) => ({
          name:
            it.unitName && it.unitName !== "PCS"
              ? `${it.productName} (${it.unitName})`
              : it.productName,
          qty: it.quantity,
          price: it.unitPrice,
          subtotal: it.subtotal,
        }));

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, phone: true },
    });
    const cfg = await this.getReceiptConfig(transaction.branchId);

    const dto: EmailReceiptDto = {
      to,
      invoiceNumber:
        transaction.invoiceDisplayNumber || transaction.invoiceNumber,
      date: formatDateWib(transaction.createdAt),
      cashier: transaction.user.name,
      items,
      subtotal: transaction.subtotal,
      discount: transaction.discountAmount,
      tax: transaction.taxAmount,
      grandTotal: transaction.grandTotal,
      paymentMethod: transaction.paymentMethod,
      paymentAmount: transaction.paymentAmount,
      change: transaction.changeAmount,
      storeName: cfg.storeName || company?.name || "MenoPOS",
      storeAddress: cfg.storeAddress || company?.address || "",
      storePhone: cfg.storePhone || company?.phone || "",
      footerText: cfg.footerText,
      thankYouMessage: cfg.thankYouMessage,
      ...(transaction.customer?.name
        ? { customer: transaction.customer.name }
        : {}),
    };

    const store = dto.storeName?.trim() || "MenoPOS";
    return this.email.send({
      to,
      subject: `Struk ${store} — ${dto.invoiceNumber}`,
      html: buildReceiptHtml(dto),
    });
  }

  private async getReceiptConfig(branchId: string | null): Promise<{
    storeName: string;
    storeAddress: string;
    storePhone: string;
    footerText: string;
    thankYouMessage: string;
  }> {
    const rows = await this.prisma.setting.findMany({
      where: { group: "receipt", OR: [{ branchId }, { branchId: null }] },
      select: { key: true, value: true, branchId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.branchId === null && map.has(r.key)) continue;
      map.set(r.key, r.value);
    }
    const get = (k: string) => map.get(`receipt.${k}`);
    return {
      storeName: get("storeName") ?? "",
      storeAddress: get("storeAddress") ?? "",
      storePhone: get("storePhone") ?? "",
      footerText: get("footerText") ?? "",
      thankYouMessage:
        get("thankYouMessage") ?? "Terima kasih, selamat berbelanja kembali!",
    };
  }
}

/** Format tanggal singkat dalam zona WIB (Asia/Jakarta). */
function formatDateWib(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
