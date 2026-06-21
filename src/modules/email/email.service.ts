import { Injectable, Logger } from "@nestjs/common";

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  /** Isi HTML. Salah satu dari `html` atau `text` wajib ada. */
  html?: string;
  /** Isi plain-text (dipakai bila `html` kosong). */
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

/**
 * Kirim email via Gmail API memakai OAuth2 akun Gmail biasa (refresh token).
 * Berbasis HTTP (bukan SMTP) jadi aman di Cloud Run. Refresh token ditukar
 * menjadi access token saat dibutuhkan (di-cache sampai mendekati kedaluwarsa);
 * tanpa dependency eksternal.
 *
 * ENV yang dibutuhkan:
 *   GMAIL_SENDER               alamat Gmail pengirim (akun yang mengotorisasi).
 *   GMAIL_SENDER_NAME          (opsional) nama tampilan, mis. "MenoPOS".
 *   GMAIL_OAUTH_CLIENT_ID      Client ID OAuth dari GCP.
 *   GMAIL_OAUTH_CLIENT_SECRET  Client secret OAuth dari GCP.
 *   GMAIL_OAUTH_REFRESH_TOKEN  Refresh token hasil consent sekali (offline).
 *
 * Cara dapat refresh token: lihat catatan di akhir percakapan (OAuth Playground).
 * Catatan: di OAuth consent status "Testing", refresh token kedaluwarsa ±7 hari
 * → untuk permanen, publish app (scope gmail.send butuh verifikasi Google).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  /** True bila kredensial email lengkap (siap kirim). */
  isConfigured(): boolean {
    return Boolean(
      process.env.GMAIL_SENDER &&
        process.env.GMAIL_OAUTH_CLIENT_ID &&
        process.env.GMAIL_OAUTH_CLIENT_SECRET &&
        process.env.GMAIL_OAUTH_REFRESH_TOKEN,
    );
  }

  private getConfig() {
    const sender = process.env.GMAIL_SENDER;
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    if (!sender || !clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Email belum dikonfigurasi: set GMAIL_SENDER, GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN",
      );
    }
    return { sender, clientId, clientSecret, refreshToken };
  }

  /** Access token Gmail (di-cache sampai mendekati kedaluwarsa). */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt > Date.now() + 60_000) {
      return this.cachedToken;
    }
    const { clientId, clientSecret, refreshToken } = this.getConfig();

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Gagal refresh token Gmail ${res.status}: ${detail.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) throw new Error("Access token Gmail kosong");
    this.cachedToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this.cachedToken;
  }

  /**
   * Kirim satu email. Mengembalikan id pesan Gmail.
   * Melempar error bila belum dikonfigurasi atau Gmail API menolak — pemanggil
   * sebaiknya membungkus dengan try/catch bila pengiriman bersifat best-effort.
   */
  async send(opts: SendEmailOptions): Promise<{ id: string }> {
    const token = await this.getAccessToken();
    const raw = this.buildRawMessage(opts);

    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gmail API ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? "" };
  }

  // ── MIME builder ─────────────────────────────────────────────────────────
  private buildRawMessage(opts: SendEmailOptions): string {
    const sender = process.env.GMAIL_SENDER as string;
    const senderName = process.env.GMAIL_SENDER_NAME;
    const from = senderName
      ? `${encodeHeaderWord(senderName)} <${sender}>`
      : sender;

    const headers: string[] = [`From: ${from}`, `To: ${toAddressList(opts.to)}`];
    if (opts.cc) headers.push(`Cc: ${toAddressList(opts.cc)}`);
    if (opts.bcc) headers.push(`Bcc: ${toAddressList(opts.bcc)}`);
    if (opts.replyTo) headers.push(`Reply-To: ${opts.replyTo}`);
    headers.push(`Subject: ${encodeHeaderWord(opts.subject)}`);
    headers.push("MIME-Version: 1.0");

    const isHtml = Boolean(opts.html);
    const body = opts.html ?? opts.text ?? "";
    headers.push(
      `Content-Type: text/${isHtml ? "html" : "plain"}; charset="UTF-8"`,
    );
    headers.push("Content-Transfer-Encoding: base64");

    const mime =
      headers.join("\r\n") +
      "\r\n\r\n" +
      chunk76(Buffer.from(body, "utf8").toString("base64"));

    // Gmail API minta base64url (tanpa padding).
    return Buffer.from(mime, "utf8").toString("base64url");
  }
}

function toAddressList(v: string | string[]): string {
  return Array.isArray(v) ? v.join(", ") : v;
}

/** Encode header (Subject/From name) ke RFC 2047 bila mengandung non-ASCII. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Pecah base64 jadi baris max 76 char (sesuai standar MIME). */
function chunk76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}
