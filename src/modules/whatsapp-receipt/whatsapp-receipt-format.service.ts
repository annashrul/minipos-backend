import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { WhatsappMessageService } from "./whatsapp-message.service";
import {
  normalizePhone,
  formatReceiptDate,
  buildThermalReceiptText,
  type ReceiptConfigShape,
} from "./whatsapp-receipt.helpers";

@Injectable()
export class WhatsappReceiptFormatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly message: WhatsappMessageService,
  ) {}

  async sendReceipt(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<{ success: true; messageId?: string }> {
    const text = await this.generateReceiptText(companyId, transactionId);
    return this.message.sendText(companyId, phone, text);
  }

  // ─── Receipt text + wa.me link (no Baileys touch) ──────────────────
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
        customer: { select: { name: true, phone: true, memberLevel: true } },
        branch: { select: { name: true } },
      },
    });
    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }

    // Kalau transaksi dibuat dari Service Order, ambil item dari ServiceOrder.
    // Alasan: TransactionItem.productId required, jadi item JASA ad-hoc (tanpa
    // productId) di-skip saat finalize SO. Tanpa ini, nota WA muncul kosong /
    // hanya berisi item produk dari katalog.
    const serviceOrder = await this.prisma.serviceOrder.findUnique({
      where: { transactionId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });

    const receiptItems = serviceOrder
      ? serviceOrder.items.map((it) => ({
          name: it.name,
          qty: it.quantity,
          unitName: it.itemType === "SERVICE" ? "JASA" : "PCS",
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          discount: it.discount,
          notes: it.notes,
        }))
      : transaction.items.map((it) => ({
          name: it.productName,
          qty: it.quantity,
          unitName: it.unitName,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          discount: it.discount,
          notes: it.notes,
        }));

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, address: true, phone: true },
    });
    const receiptCfg = await this.getReceiptConfig(transaction.branchId);

    const storeName = receiptCfg.storeName || company?.name || "POS MINIMARKET";
    const storeAddress = receiptCfg.storeAddress || company?.address || "";
    const storePhone = receiptCfg.storePhone || company?.phone || "";

    return buildThermalReceiptText({
      width: receiptCfg.paperWidth === 58 ? 28 : 32,
      storeName,
      storeAddress,
      storePhone,
      headerText: receiptCfg.headerText,
      footerText: receiptCfg.footerText,
      thankYouMessage: receiptCfg.thankYouMessage,
      showCashierName: receiptCfg.showCashierName,
      showDateTime: receiptCfg.showDateTime,
      showPaymentMethod: receiptCfg.showPaymentMethod,
      transaction: {
        invoiceNumber:
          transaction.invoiceDisplayNumber || transaction.invoiceNumber,
        date: formatReceiptDate(transaction.createdAt),
        cashier: transaction.user.name,
        branch: transaction.branch?.name ?? null,
        customer: transaction.customer?.name ?? null,
        memberLevel: transaction.customer?.memberLevel ?? null,
        items: receiptItems,
        subtotal: transaction.subtotal,
        discountAmount: transaction.discountAmount,
        taxAmount: transaction.taxAmount,
        grandTotal: transaction.grandTotal,
        paymentMethod: transaction.paymentMethod,
        paymentAmount: transaction.paymentAmount,
        changeAmount: transaction.changeAmount,
        payments: transaction.payments.map((p) => ({
          method: p.method,
          amount: p.amount,
        })),
        promoApplied: transaction.promoApplied,
      },
    });
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

  private async getReceiptConfig(
    branchId: string | null,
  ): Promise<ReceiptConfigShape> {
    const rows = await this.prisma.setting.findMany({
      where: {
        group: "receipt",
        OR: [{ branchId }, { branchId: null }],
      },
      select: { key: true, value: true, branchId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.branchId === null && map.has(r.key)) continue;
      map.set(r.key, r.value);
    }
    const get = (k: string) => map.get(`receipt.${k}`);
    const bool = (k: string, fallback: boolean) => {
      const v = get(k);
      if (v === undefined) return fallback;
      return v !== "false";
    };
    return {
      storeName: get("storeName") ?? "",
      storeAddress: get("storeAddress") ?? "",
      storePhone: get("storePhone") ?? "",
      headerText: get("headerText") ?? "",
      footerText:
        get("footerText") ??
        "Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat dikembalikan kecuali ada kesepakatan.",
      thankYouMessage:
        get("thankYouMessage") ?? "Terima kasih, selamat berbelanja kembali!",
      paperWidth: Number(get("paperWidth") ?? 80),
      showCashierName: bool("showCashierName", true),
      showDateTime: bool("showDateTime", true),
      showPaymentMethod: bool("showPaymentMethod", true),
    };
  }
}
