import { Injectable, Logger } from "@nestjs/common";
import type {
  WaServiceSendTextResult,
  WaServiceSession,
} from "./wa-service.types";

// Thin HTTP client untuk wa-service.
// CATATAN KEAMANAN: minipos sengaja TIDAK menyimpan WA_SERVICE_ADMIN_TOKEN.
// Tenant per-company di-provision manual di UI wa-service oleh admin,
// lalu apiKey + webhookSecret di-input ke minipos lewat endpoint setup
// (lihat WhatsappReceiptController). Client ini hanya pegang tenant-scoped
// operation, bukan admin operation.
@Injectable()
export class WaServiceClient {
  private readonly logger = new Logger(WaServiceClient.name);

  get baseUrl(): string {
    const url = process.env.WA_SERVICE_URL;
    if (!url) {
      throw new Error(
        "WA_SERVICE_URL belum di-set di environment minipos backend",
      );
    }
    return url.replace(/\/$/, "");
  }

  // ─── Low-level request ──────────────────────────────────────────
  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        (parsed as { message?: string } | null)?.message ??
        `wa-service HTTP ${res.status} pada ${method} ${path}`;
      this.logger.warn(`${method} ${path} → ${res.status}: ${msg}`);
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const data =
      (parsed as { data?: T } | null)?.data !== undefined
        ? (parsed as { data: T }).data
        : (parsed as T);
    return data;
  }

  private tenantHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}` };
  }

  // ─── Validation (untuk setup flow) ─────────────────────────────
  // Resolve apiKey ke { id, name, status } tenant. Dipakai saat admin minipos
  // input credentials — verify apiKey valid + tenantId yang di-input cocok.
  async getMe(
    apiKey: string,
  ): Promise<{ id: string; name: string; status: "ACTIVE" | "SUSPENDED" }> {
    return this.request("GET", "/api/me", this.tenantHeaders(apiKey));
  }

  // ─── Tenant: session ────────────────────────────────────────────
  async getSession(apiKey: string): Promise<WaServiceSession> {
    return this.request("GET", "/api/session", this.tenantHeaders(apiKey));
  }

  async connectSession(
    apiKey: string,
    forceReconnect = false,
  ): Promise<WaServiceSession> {
    return this.request(
      "POST",
      "/api/session/connect",
      this.tenantHeaders(apiKey),
      { forceReconnect },
    );
  }

  async disconnectSession(apiKey: string): Promise<WaServiceSession> {
    return this.request(
      "POST",
      "/api/session/disconnect",
      this.tenantHeaders(apiKey),
    );
  }

  async logoutSession(apiKey: string): Promise<WaServiceSession> {
    return this.request(
      "POST",
      "/api/session/logout",
      this.tenantHeaders(apiKey),
    );
  }

  // ─── Tenant: messages ───────────────────────────────────────────
  async sendText(
    apiKey: string,
    phone: string,
    message: string,
  ): Promise<WaServiceSendTextResult> {
    return this.request(
      "POST",
      "/api/messages/send-text",
      this.tenantHeaders(apiKey),
      { phone, message },
    );
  }
}
