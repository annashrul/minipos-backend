import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Generates digital receipt text for a transaction and a wa.me link.
 * The actual sending happens client-side by opening the wa.me URL in a new tab.
 *
 * Currently a thin proxy/builder. If a real WA gateway (e.g. Fonnte, Wablas,
 * Twilio) is added later, expose a `send()` method here.
 */
@Injectable()
export class WhatsappReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async generateReceiptText(
    companyId: string,
    transactionId: string,
  ): Promise<string> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        payments: { orderBy: { createdAt: "asc" } },
        user: { select: { name: true } },
        customer: { select: { name: true, phone: true } },
        branch: { select: { name: true } },
      },
    });

    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }

    const lines: string[] = [];
    const sep = "━".repeat(20);

    lines.push("🧾 *NusaPOS - Struk Digital*");
    lines.push(sep);
    lines.push(`Invoice: ${transaction.invoiceNumber}`);
    lines.push(`Tanggal: ${formatReceiptDate(transaction.createdAt)}`);
    lines.push(`Kasir: ${transaction.user.name}`);
    if (transaction.branch) {
      lines.push(`Cabang: ${transaction.branch.name}`);
    }
    if (transaction.customer) {
      lines.push(`Customer: ${transaction.customer.name}`);
    }
    lines.push("");

    lines.push("*Detail Belanja:*");
    transaction.items.forEach((item, idx) => {
      const qtyLabel =
        item.unitName && item.unitName !== "PCS"
          ? `${item.quantity} ${item.unitName}`
          : `x${item.quantity}`;
      let line = `${idx + 1}. ${item.productName} ${qtyLabel}  ${formatRupiah(item.subtotal)}`;
      if (item.discount > 0) {
        line += ` (disc ${formatRupiah(item.discount)})`;
      }
      lines.push(line);
    });

    lines.push(sep);
    lines.push(`Subtotal:    ${formatRupiah(transaction.subtotal)}`);

    if (transaction.discountAmount > 0) {
      lines.push(`Diskon:      -${formatRupiah(transaction.discountAmount)}`);
    }
    if (transaction.taxAmount > 0) {
      lines.push(`Pajak:       ${formatRupiah(transaction.taxAmount)}`);
    }

    lines.push(`*TOTAL:      ${formatRupiah(transaction.grandTotal)}*`);
    lines.push("");

    if (transaction.payments.length > 1) {
      lines.push("*Pembayaran:*");
      transaction.payments.forEach((p) => {
        lines.push(
          `  ${paymentMethodLabel(p.method)}: ${formatRupiah(p.amount)}`,
        );
      });
    } else {
      lines.push(
        `Bayar (${paymentMethodLabel(transaction.paymentMethod)}): ${formatRupiah(transaction.paymentAmount)}`,
      );
    }

    if (transaction.changeAmount > 0) {
      lines.push(`Kembali:      ${formatRupiah(transaction.changeAmount)}`);
    }

    lines.push("");
    lines.push("Terima kasih! 🙏");

    return lines.join("\n");
  }

  async generateLink(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<string> {
    const text = await this.generateReceiptText(companyId, transactionId);
    const normalizedPhone = normalizePhone(phone);
    const encodedText = encodeURIComponent(text);
    return `https://wa.me/${normalizedPhone}?text=${encodedText}`;
  }
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatReceiptDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    CASH: "CASH",
    TRANSFER: "TRANSFER",
    QRIS: "QRIS",
    EWALLET: "E-WALLET",
    DEBIT: "DEBIT",
    CREDIT_CARD: "KARTU KREDIT",
    TERMIN: "TERMIN",
  };
  return labels[method] || method;
}

/**
 * Normalize Indonesian phone number to international format (62xxx).
 * - Removes spaces, dashes, parentheses
 * - 08xxx -> 628xxx
 * - +62xxx -> 62xxx
 * - 62xxx -> 62xxx (unchanged)
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]+/g, "");
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  }
  return cleaned;
}
