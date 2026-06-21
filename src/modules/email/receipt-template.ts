import type { EmailReceiptDto } from "./dto/email.dto";

/** Format angka ke Rupiah tanpa simbol (mis. 11.100). */
function rp(n: number): string {
  return Math.round(n).toLocaleString("id-ID");
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Tunai",
  TRANSFER: "Transfer",
  QRIS: "QRIS",
  EWALLET: "E-Wallet",
  DEBIT: "Kartu Debit",
  CREDIT_CARD: "Kartu Kredit",
  TERMIN: "Termin",
  SPLIT_BILL: "Split Bill",
};

/** Bangun struk HTML rapi (email-client friendly, inline styles). */
export function buildReceiptHtml(dto: EmailReceiptDto): string {
  const storeName = dto.storeName?.trim() || "Struk Pembelian";

  const itemRows = dto.items
    .map((it) => {
      const unit =
        it.qty > 0 ? `${it.qty} x ${rp(it.price)}` : rp(it.price);
      return (
        `<tr>` +
        `<td style="padding:6px 0;border-bottom:1px solid #f0f0f0">` +
        `<div style="font-size:13px;color:#1a1a1a">${esc(it.name)}</div>` +
        `<div style="font-size:11px;color:#888">${esc(unit)}</div>` +
        `</td>` +
        `<td style="padding:6px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-size:13px;color:#1a1a1a;white-space:nowrap;vertical-align:top">${rp(it.subtotal)}</td>` +
        `</tr>`
      );
    })
    .join("");

  const line = (label: string, value: string, bold = false) =>
    `<tr>` +
    `<td style="padding:3px 0;font-size:${bold ? "15px" : "13px"};color:#1a1a1a;${bold ? "font-weight:700" : ""}">${esc(label)}</td>` +
    `<td style="padding:3px 0;text-align:right;font-size:${bold ? "15px" : "13px"};color:#1a1a1a;${bold ? "font-weight:700" : ""};white-space:nowrap">${value}</td>` +
    `</tr>`;

  const totals: string[] = [line("Subtotal", rp(dto.subtotal))];
  if (dto.discount > 0) totals.push(line("Diskon", `- ${rp(dto.discount)}`));
  if (dto.tax > 0) totals.push(line("Pajak", rp(dto.tax)));
  totals.push(line("TOTAL", rp(dto.grandTotal), true));

  const payLines: string[] = [];
  if (dto.paymentMethod) {
    const pm = PAYMENT_LABELS[dto.paymentMethod] ?? dto.paymentMethod;
    payLines.push(line(pm, rp(dto.paymentAmount ?? dto.grandTotal)));
    if (typeof dto.change === "number" && dto.change > 0)
      payLines.push(line("Kembali", rp(dto.change)));
  }

  const meta: string[] = [
    `<div style="display:flex;justify-content:space-between;font-size:12px;color:#666"><span>No</span><span style="font-family:monospace">${esc(dto.invoiceNumber)}</span></div>`,
    `<div style="display:flex;justify-content:space-between;font-size:12px;color:#666"><span>Tanggal</span><span>${esc(dto.date)}</span></div>`,
  ];
  if (dto.cashier)
    meta.push(
      `<div style="display:flex;justify-content:space-between;font-size:12px;color:#666"><span>Kasir</span><span>${esc(dto.cashier)}</span></div>`,
    );
  if (dto.customer)
    meta.push(
      `<div style="display:flex;justify-content:space-between;font-size:12px;color:#666"><span>Pelanggan</span><span>${esc(dto.customer)}</span></div>`,
    );

  const dashed = `<div style="border-top:1px dashed #ccc;margin:12px 0"></div>`;

  return (
    `<div style="background:#f4f4f5;padding:24px 0;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif">` +
    `<div style="max-width:380px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">` +
    `<div style="text-align:center">` +
    `<h1 style="margin:0;font-size:18px;color:#1a1a1a">${esc(storeName)}</h1>` +
    (dto.storeAddress
      ? `<div style="font-size:11px;color:#888;margin-top:2px">${esc(dto.storeAddress)}</div>`
      : "") +
    (dto.storePhone
      ? `<div style="font-size:11px;color:#888">${esc(dto.storePhone)}</div>`
      : "") +
    `</div>` +
    dashed +
    meta.join("") +
    dashed +
    `<table style="width:100%;border-collapse:collapse">${itemRows}</table>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:10px">${totals.join("")}</table>` +
    (payLines.length
      ? dashed +
        `<table style="width:100%;border-collapse:collapse">${payLines.join("")}</table>`
      : "") +
    dashed +
    (dto.footerText
      ? `<div style="text-align:center;font-size:11px;color:#666;white-space:pre-line">${esc(dto.footerText)}</div>`
      : "") +
    (dto.thankYouMessage
      ? `<div style="text-align:center;font-size:12px;font-weight:600;color:#1a1a1a;margin-top:6px">${esc(dto.thankYouMessage)}</div>`
      : "") +
    `<div style="text-align:center;font-size:10px;color:#bbb;margin-top:16px">Struk digital — dikirim otomatis oleh MenoPOS</div>` +
    `</div></div>`
  );
}
