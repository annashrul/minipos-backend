// ═══ Shared helpers & types for whatsapp-receipt module ═════════════════
// Extracted so sub-services can import without circular dependencies.

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

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatReceiptDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    CASH: "Tunai",
    TRANSFER: "Transfer",
    QRIS: "QRIS",
    EWALLET: "E-Wallet",
    DEBIT: "Debit",
    CREDIT_CARD: "Kartu Kredit",
    TERMIN: "Termin",
    SPLIT_BILL: "Split Bill",
  };
  return labels[method] || method;
}

// ─── Receipt types ───────────────────────────────────────────────────

export type ReceiptConfigShape = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  headerText: string;
  footerText: string;
  thankYouMessage: string;
  paperWidth: number;
  showCashierName: boolean;
  showDateTime: boolean;
  showPaymentMethod: boolean;
};

export type ReceiptItemData = {
  name: string;
  qty: number;
  unitName: string | null;
  unitPrice: number;
  subtotal: number;
  discount: number;
  notes: string | null;
};

export type ReceiptTransactionData = {
  invoiceNumber: string;
  date: string;
  cashier: string;
  branch: string | null;
  customer: string | null;
  memberLevel: string | null;
  items: ReceiptItemData[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  paymentAmount: number;
  changeAmount: number;
  payments: { method: string; amount: number }[];
  promoApplied: string | null;
};

// ─── Thermal receipt text builder ────────────────────────────────────

export function buildThermalReceiptText(input: {
  width: number;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  headerText: string;
  footerText: string;
  thankYouMessage: string;
  showCashierName: boolean;
  showDateTime: boolean;
  showPaymentMethod: boolean;
  transaction: ReceiptTransactionData;
}): string {
  const W = Math.max(24, Math.min(40, input.width));
  const tx = input.transaction;
  const lines: string[] = [];

  const center = (s: string) => {
    const truncated = s.length > W ? s.slice(0, W) : s;
    const pad = Math.max(0, Math.floor((W - truncated.length) / 2));
    return " ".repeat(pad) + truncated;
  };
  const row = (left: string, right: string) => {
    const space = Math.max(1, W - left.length - right.length);
    return left + " ".repeat(space) + right;
  };
  const rule = (ch: string) => ch.repeat(W);
  const wrap = (s: string, indent = 0) => {
    const max = W - indent;
    if (s.length <= max) return [" ".repeat(indent) + s];
    const out: string[] = [];
    const words = s.split(" ");
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max) {
        out.push(" ".repeat(indent) + cur.trim());
        cur = w;
      } else {
        cur = (cur + " " + w).trim();
      }
    }
    if (cur) out.push(" ".repeat(indent) + cur.trim());
    return out;
  };
  const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);

  // Header
  lines.push(center(input.storeName.toUpperCase()));
  if (input.storeAddress) {
    for (const ln of input.storeAddress.split("\n")) {
      if (ln.trim()) lines.push(...wrap(ln.trim()).map(center));
    }
  }
  if (input.storePhone) lines.push(center(input.storePhone));
  if (input.headerText.trim()) {
    for (const ln of input.headerText.split("\n")) {
      if (ln.trim()) lines.push(...wrap(ln.trim()).map(center));
    }
  }
  lines.push(rule("="));

  // Meta
  lines.push(`No: ${tx.invoiceNumber}`);
  if (input.showDateTime) lines.push(tx.date);
  if (input.showCashierName) lines.push(`Kasir: ${tx.cashier}`);
  if (tx.branch) lines.push(`Cabang: ${tx.branch}`);
  if (tx.customer) {
    const lvl = tx.memberLevel ? ` (${tx.memberLevel})` : "";
    lines.push(`Member: ${tx.customer}${lvl}`);
  }
  lines.push(rule("-"));

  const safeRow = (left: string, right: string) => {
    if (left.length + 1 + right.length <= W) {
      return [row(left, right)];
    }
    return [left, row("", right)];
  };
  for (const item of tx.items) {
    const unit =
      item.unitName && item.unitName.toUpperCase() !== "PCS"
        ? ` ${item.unitName}`
        : "";
    const subtotalStr = fmt(item.subtotal);
    const isSingleSimple =
      item.qty === 1 && !unit && item.discount === 0 && !item.notes;

    if (isSingleSimple) {
      const nameMax = W - subtotalStr.length - 1;
      if (item.name.length <= nameMax) {
        lines.push(row(item.name, subtotalStr));
      } else {
        const nameWrapped = wrap(item.name, 0);
        lines.push(...nameWrapped);
        lines.push(row("", subtotalStr));
      }
      continue;
    }

    lines.push(...wrap(item.name, 0));
    const qtyLine = `  ${item.qty}${unit} x ${fmt(item.unitPrice)}`;
    lines.push(...safeRow(qtyLine, subtotalStr));
    if (item.discount > 0) {
      lines.push(...safeRow("  Diskon item", `-${fmt(item.discount)}`));
    }
    if (item.notes) {
      for (const ln of wrap(`* ${item.notes}`, 4)) lines.push(ln);
    }
  }

  lines.push(rule("-"));

  lines.push(row("Subtotal", fmt(tx.subtotal)));
  if (tx.discountAmount > 0) {
    lines.push(row("Diskon", `-${fmt(tx.discountAmount)}`));
  }
  if (tx.taxAmount > 0) lines.push(row("Pajak", fmt(tx.taxAmount)));
  lines.push(rule("="));
  lines.push(row("TOTAL", `Rp ${fmt(tx.grandTotal)}`));
  lines.push(rule("="));

  if (input.showPaymentMethod) {
    const payments =
      tx.payments.length > 0
        ? tx.payments
        : [{ method: tx.paymentMethod, amount: tx.paymentAmount }];
    if (payments.length > 1) {
      lines.push("Pembayaran:");
      for (const p of payments) {
        lines.push(
          row(`  ${paymentMethodLabel(p.method)}`, `Rp ${fmt(p.amount)}`),
        );
      }
      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      lines.push(row("  Total Bayar", `Rp ${fmt(totalPaid)}`));
    } else {
      const p = payments[0]!;
      lines.push(row(paymentMethodLabel(p.method), `Rp ${fmt(p.amount)}`));
    }
  }
  if (tx.changeAmount > 0) {
    lines.push(row("Kembali", `Rp ${fmt(tx.changeAmount)}`));
  }

  if (tx.promoApplied) {
    lines.push(rule("-"));
    for (const ln of wrap(`Promo: ${tx.promoApplied}`)) lines.push(ln);
  }

  lines.push(rule("-"));
  if (input.footerText.trim()) {
    for (const ln of input.footerText.split("\n")) {
      if (ln.trim()) lines.push(...wrap(ln.trim()).map(center));
    }
  }
  if (input.thankYouMessage.trim()) {
    lines.push("");
    for (const ln of input.thankYouMessage.split("\n")) {
      if (ln.trim()) lines.push(...wrap(ln.trim()).map(center));
    }
  }

  // FIGURE SPACE U+2007 — lebar persis = digit, NEVER di-collapse oleh WA.
  const FIG = " ";
  const fixed = lines.map((ln) => {
    const padded = ln.length >= W ? ln : ln + FIG.repeat(W - ln.length);
    return padded.replace(/ /g, FIG);
  });

  return "```\n" + fixed.join("\n") + "\n```";
}
