import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private smtp: Transporter | null = null;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      this.smtp = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(
      this.smtp ||
      this.resend ||
      (process.env.GMAIL_SENDER &&
        process.env.GMAIL_OAUTH_CLIENT_ID &&
        process.env.GMAIL_OAUTH_CLIENT_SECRET &&
        process.env.GMAIL_OAUTH_REFRESH_TOKEN),
    );
  }

  async send(opts: SendEmailOptions): Promise<{ id: string }> {
    if (this.smtp) return this.sendViaSmtp(opts);
    if (this.resend) return this.sendViaResend(opts);
    return this.sendViaGmail(opts);
  }

  // ── Gmail SMTP (App Password) ──────────────────────────────────────────

  private async sendViaSmtp(opts: SendEmailOptions): Promise<{ id: string }> {
    const from = process.env.GMAIL_SENDER_NAME
      ? `"${process.env.GMAIL_SENDER_NAME}" <${process.env.GMAIL_USER}>`
      : (process.env.GMAIL_USER as string);

    const info = await this.smtp!.sendMail({
      from,
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(opts.cc ? { cc: Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc } : {}),
      ...(opts.bcc ? { bcc: Array.isArray(opts.bcc) ? opts.bcc.join(", ") : opts.bcc } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });

    return { id: info.messageId };
  }

  // ── Resend ──────────────────────────────────────────────────────────────

  private async sendViaResend(opts: SendEmailOptions): Promise<{ id: string }> {
    const from =
      process.env.RESEND_FROM ??
      process.env.GMAIL_SENDER ??
      "MenoPOS <onboarding@resend.dev>";
    const senderName = process.env.GMAIL_SENDER_NAME ?? process.env.RESEND_SENDER_NAME;
    const fromWithName = senderName ? `${senderName} <${from}>` : from;

    const payload: Record<string, unknown> = {
      from: fromWithName,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
    };
    if (opts.html) payload.html = opts.html;
    if (opts.text) payload.text = opts.text;
    if (opts.cc) payload.cc = Array.isArray(opts.cc) ? opts.cc : [opts.cc];
    if (opts.bcc) payload.bcc = Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc];
    if (opts.replyTo) payload.reply_to = opts.replyTo;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await this.resend!.emails.send(payload as any);

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
    return { id: data?.id ?? "" };
  }

  // ── Gmail OAuth2 (fallback) ─────────────────────────────────────────────

  private getGmailConfig() {
    const sender = process.env.GMAIL_SENDER;
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    if (!sender || !clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Email belum dikonfigurasi: set RESEND_API_KEY atau GMAIL_OAUTH_*",
      );
    }
    return { sender, clientId, clientSecret, refreshToken };
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt > Date.now() + 60_000) {
      return this.cachedToken;
    }
    const { clientId, clientSecret, refreshToken } = this.getGmailConfig();

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

  private async sendViaGmail(opts: SendEmailOptions): Promise<{ id: string }> {
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

    return Buffer.from(mime, "utf8").toString("base64url");
  }
}

function toAddressList(v: string | string[]): string {
  return Array.isArray(v) ? v.join(", ") : v;
}

function encodeHeaderWord(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function chunk76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}
