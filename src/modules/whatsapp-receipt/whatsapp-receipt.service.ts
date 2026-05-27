import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import { WaServiceClient } from "@/common/wa-service/wa-service.client";
import type {
  WaServiceInboundEvent,
  WaServiceSession,
  WaServiceSessionStage,
} from "@/common/wa-service/wa-service.types";
import { WaServiceSocketService } from "./wa-service-socket.service";
import { WhatsappMessageService } from "./whatsapp-message.service";
import { WhatsappReceiptFormatService } from "./whatsapp-receipt-format.service";

// ─── Types eksternal (di-export buat kompatibilitas controller/chatbot) ──
type SessionStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

export type SessionStage = WaServiceSessionStage;

type SessionView = {
  status: SessionStatus;
  stage: SessionStage;
  phoneNumber: string | null;
  deviceName: string | null;
  qrCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
};

// Callback yang dipanggil setiap kali pesan inbound (bukan fromMe) diterima
// dari webhook wa-service. Dipakai WhatsappChatbotService untuk auto-reply
// tanpa bikin circular dependency antar module — chatbot register handler
// di onModuleInit.
export type InboundMessageHandler = (params: {
  companyId: string;
  fromNumber: string | null;
  remoteJid: string;
  content: string | null;
  fromMe: boolean;
  isGroup: boolean;
}) => void | Promise<void>;

type TenantCredentials = {
  tenantId: string;
  apiKey: string;
  webhookSecret: string;
};

// WhatsappReceiptService versi baru: tipis HTTP client ke `wa-service`.
// Semua interaksi Baileys (socket, signal keys, throttle, queue) pindah ke
// wa-service. Service ini hanya:
//   1. Resolve tenant credentials (yang sudah di-setup manual oleh admin)
//   2. Forward call session/messages via WaServiceClient
//   3. Terima webhook (inbound, session_updated) lewat WhatsappWebhookController
//   4. Persist log pesan + cache snapshot status di tabel lokal supaya
//      query history & dashboard tidak perlu round-trip ke wa-service
//
// Tenant per-company di-provision MANUAL di UI wa-service oleh admin (bukan
// auto-provisioning lewat /admin/tenants), supaya minipos tidak perlu pegang
// WA_SERVICE_ADMIN_TOKEN. Admin minipos input apiKey + webhookSecret lewat
// endpoint POST /whatsapp-receipt/setup setelah create tenant di wa-service.
@Injectable()
export class WhatsappReceiptService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappReceiptService.name);
  private readonly inboundHandlers: InboundMessageHandler[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly wa: WaServiceClient,
    private readonly socket: WaServiceSocketService,
    private readonly messageService: WhatsappMessageService,
    private readonly receiptFormatService: WhatsappReceiptFormatService,
  ) {}

  onModuleInit(): void {
    // Register handler ke socket service. Saat wa-service push event lewat
    // socket, handler ini di-invoke (sama dengan flow webhook lama).
    this.socket.onSessionUpdated((tenantId, data) =>
      this.handleSessionWebhook(tenantId, data),
    );
    this.socket.onInboundMessage((tenantId, data) =>
      this.handleInboundWebhook(tenantId, data),
    );
    // Tenant dihapus di sisi wa-service → auto-clear credentials lokal
    // supaya company minipos kembali ke state "belum setup".
    this.socket.onTenantDeleted((tenantId) =>
      this.handleTenantDeleted(tenantId),
    );
  }

  onModuleDestroy(): void {
    // No-op. Tidak ada socket lokal yang perlu di-close.
  }

  // ─── Inbound handler registry (dipanggil chatbot) ─────────────────
  registerInboundHandler(h: InboundMessageHandler): void {
    this.inboundHandlers.push(h);
  }

  // ─── Session API ───────────────────────────────────────────────────
  async getSession(companyId: string): Promise<SessionView> {
    const creds = await this.ensureTenantCredentials(companyId);
    try {
      const live = await this.wa.getSession(creds.apiKey);
      // Best-effort cache supaya kalau wa-service down, kita masih bisa
      // tampilkan snapshot terakhir di UI tanpa error.
      await this.cacheSnapshot(companyId, live);
      return this.toSessionView(live);
    } catch (err) {
      this.logger.warn(
        `getSession company=${companyId} fallback ke DB snapshot: ${(err as Error).message}`,
      );
      return this.snapshotFromDb(companyId);
    }
  }

  async connect(
    companyId: string,
    forceReconnect = false,
  ): Promise<SessionView> {
    const creds = await this.ensureTenantCredentials(companyId);
    const live = await this.wa.connectSession(creds.apiKey, forceReconnect);
    await this.cacheSnapshot(companyId, live);
    return this.toSessionView(live);
  }

  async disconnect(companyId: string): Promise<SessionView> {
    const creds = await this.ensureTenantCredentials(companyId);
    const live = await this.wa.disconnectSession(creds.apiKey);
    await this.cacheSnapshot(companyId, live);
    return this.toSessionView(live);
  }

  async logout(companyId: string): Promise<SessionView> {
    const creds = await this.ensureTenantCredentials(companyId);
    const live = await this.wa.logoutSession(creds.apiKey);
    await this.cacheSnapshot(companyId, live);
    return this.toSessionView(live);
  }

  // ─── Delegated: outbound messages ──────────────────────────────────
  sendText(
    companyId: string,
    phone: string,
    message: string,
  ): Promise<{ success: true; messageId?: string }> {
    return this.messageService.sendText(companyId, phone, message);
  }

  sendTextToJid(
    companyId: string,
    jidOrPhone: string,
    message: string,
  ): Promise<{ success: true; messageId?: string }> {
    return this.messageService.sendTextToJid(companyId, jidOrPhone, message);
  }

  listMessages(
    companyId: string,
    opts: {
      limit?: number;
      cursor?: string;
      phone?: string;
      direction?: "INBOUND" | "OUTBOUND";
    } = {},
  ) {
    return this.messageService.listMessages(companyId, opts);
  }

  // ─── Delegated: receipt formatting ─────────────────────────────────
  sendReceipt(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<{ success: true; messageId?: string }> {
    return this.receiptFormatService.sendReceipt(
      companyId,
      transactionId,
      phone,
    );
  }

  generateReceiptText(
    companyId: string,
    transactionId: string,
  ): Promise<string> {
    return this.receiptFormatService.generateReceiptText(
      companyId,
      transactionId,
    );
  }

  generateLink(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<string> {
    return this.receiptFormatService.generateLink(
      companyId,
      transactionId,
      phone,
    );
  }

  // ═══ Webhook handlers (dipanggil dari WhatsappWebhookController) ══════

  async handleInboundWebhook(
    tenantId: string,
    data: WaServiceInboundEvent,
  ): Promise<void> {
    const session = await this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { id: true, companyId: true },
    });
    if (!session) {
      this.logger.warn(
        `INBOUND_MESSAGE diterima untuk tenant tidak dikenal: ${tenantId}`,
      );
      return;
    }
    if (data.fromMe) return;

    // Persist log inbound dulu — handler chatbot mungkin query history.
    await this.prisma.whatsappMessageLog.create({
      data: {
        sessionId: session.id,
        direction: "INBOUND",
        fromNumber: data.fromNumber,
        messageType: "text",
        content: data.content,
        status: "RECEIVED",
        providerMessageId: data.providerMessageId,
      },
    });

    const handlerPayload = {
      companyId: session.companyId,
      fromNumber: data.fromNumber ?? null,
      remoteJid: data.remoteJid,
      content: data.content,
      fromMe: data.fromMe ?? false,
      isGroup: data.isGroup ?? false,
    };

    for (const h of this.inboundHandlers) {
      try {
        await h(handlerPayload);
      } catch (err) {
        this.logger.error(
          `Inbound handler error: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
  }

  async handleSessionWebhook(
    tenantId: string,
    data: WaServiceSession,
  ): Promise<void> {
    const session = await this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { id: true, companyId: true },
    });
    if (!session) {
      this.logger.warn(
        `SESSION_UPDATED untuk tenant tidak dikenal: ${tenantId}`,
      );
      return;
    }
    await this.cacheSnapshot(session.companyId, data);
    this.realtime.emit(EVENTS.WA_SESSION_UPDATED, {
      companyId: session.companyId,
      status: data.status,
      stage: data.stage,
      hasQr: Boolean(data.qrCode),
      phoneNumber: data.phoneNumber ?? null,
      deviceName: data.deviceName ?? null,
      reason: data.lastError ?? null,
    });
  }

  // ═══ Setup flow (manual provisioning) ═════════════════════════════════
  //
  // Workflow:
  //   1. Admin buka wa-service UI → create tenant → catat tenantId + apiKey + webhookSecret
  //   2. Admin minipos input ketiganya lewat POST /whatsapp-receipt/setup
  //   3. Service ini validasi via WaServiceClient.getMe(apiKey) — pastikan
  //      apiKey valid dan tenantId yang di-input cocok
  //   4. Simpan ke DB → semua call session/messages bisa jalan

  async getSetupStatus(companyId: string): Promise<{
    configured: boolean;
    tenantId: string | null;
    tenantName: string | null;
  }> {
    const row = await this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: {
        waServiceTenantId: true,
        waServiceApiKey: true,
      },
    });
    const configured =
      Boolean(row?.waServiceTenantId) && Boolean(row?.waServiceApiKey);
    if (!configured) {
      return { configured: false, tenantId: null, tenantName: null };
    }
    // Best-effort fetch nama tenant supaya UI bisa tampilkan "Connected to: X"
    let tenantName: string | null = null;
    try {
      const me = await this.wa.getMe(row!.waServiceApiKey!);
      tenantName = me.name;
    } catch (err) {
      this.logger.warn(
        `getMe gagal saat getSetupStatus company=${companyId}: ${(err as Error).message}`,
      );
    }
    return {
      configured: true,
      tenantId: row!.waServiceTenantId,
      tenantName,
    };
  }

  async setupCredentials(
    companyId: string,
    input: { tenantId: string; apiKey: string; webhookSecret: string },
  ): Promise<{ tenantId: string; tenantName: string }> {
    // 1. Validasi apiKey + tenantId via wa-service /api/me
    let me: { id: string; name: string; status: string };
    try {
      me = await this.wa.getMe(input.apiKey);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        throw new BadRequestException("API key tidak valid di wa-service");
      }
      throw new BadRequestException(
        `Gagal verify ke wa-service: ${(err as Error).message}`,
      );
    }
    if (me.id !== input.tenantId) {
      throw new BadRequestException(
        `Tenant ID tidak cocok dengan API key. API key milik tenant "${me.id}", bukan "${input.tenantId}".`,
      );
    }
    if (me.status !== "ACTIVE") {
      throw new BadRequestException(
        `Tenant "${me.name}" status ${me.status} di wa-service. Aktifkan dulu.`,
      );
    }

    // 2. Simpan credentials
    await this.prisma.whatsappSession.upsert({
      where: { companyId },
      create: {
        companyId,
        waServiceTenantId: input.tenantId,
        waServiceApiKey: input.apiKey,
        waServiceWebhookSecret: input.webhookSecret,
      },
      update: {
        waServiceTenantId: input.tenantId,
        waServiceApiKey: input.apiKey,
        waServiceWebhookSecret: input.webhookSecret,
      },
    });

    // Open socket connection ke wa-service buat company ini (idempotent —
    // disconnect existing dulu kalau ada).
    this.socket.connectTenant(companyId, input.tenantId, input.apiKey);

    this.logger.log(
      `Wa-service credentials ter-setup untuk company=${companyId} → tenant ${input.tenantId} (${me.name})`,
    );
    return { tenantId: input.tenantId, tenantName: me.name };
  }

  async clearCredentials(companyId: string): Promise<void> {
    await this.prisma.whatsappSession.updateMany({
      where: { companyId },
      data: {
        waServiceTenantId: null,
        waServiceApiKey: null,
        waServiceWebhookSecret: null,
      },
    });
    this.socket.disconnectTenant(companyId);
    this.logger.log(`Wa-service credentials cleared untuk company=${companyId}`);
  }

  // Dipanggil saat socket service terima event `tenant.deleted` dari
  // wa-service — tenant dihapus admin di sana, kita auto-cleanup di sini.
  // Lookup companyId dari tenantId, clear credentials, lalu reset session
  // snapshot supaya UI minipos kembali ke "DISCONNECTED" + setup form.
  async handleTenantDeleted(tenantId: string): Promise<void> {
    const row = await this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { companyId: true },
    });
    if (!row) {
      this.logger.warn(
        `handleTenantDeleted: tidak ada company untuk tenantId=${tenantId}`,
      );
      return;
    }
    const { companyId } = row;
    this.logger.warn(
      `Tenant ${tenantId} dihapus di wa-service — auto force-logout company=${companyId}`,
    );

    // Clear credentials + reset snapshot session.
    await this.prisma.whatsappSession.update({
      where: { companyId },
      data: {
        waServiceTenantId: null,
        waServiceApiKey: null,
        waServiceWebhookSecret: null,
        status: "DISCONNECTED",
        stage: "IDLE",
        qrCode: null,
        phoneNumber: null,
        deviceName: null,
        lastDisconnectedAt: new Date(),
        lastError: "Tenant dihapus dari wa-service oleh admin.",
      },
    });

    // Disconnect socket subscription untuk company ini.
    this.socket.disconnectTenant(companyId);

    // Push update ke frontend supaya UI auto-redirect ke setup form.
    this.realtime.emit(EVENTS.WA_SESSION_UPDATED, {
      companyId,
      status: "DISCONNECTED",
      stage: "IDLE",
      hasQr: false,
      phoneNumber: null,
      deviceName: null,
      reason: "Tenant dihapus dari wa-service.",
    });
  }

  // ═══ Internal: tenant credentials lookup + snapshot ═══════════════════

  private async ensureTenantCredentials(
    companyId: string,
  ): Promise<TenantCredentials> {
    const existing = await this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: {
        waServiceTenantId: true,
        waServiceApiKey: true,
        waServiceWebhookSecret: true,
      },
    });
    if (
      !existing?.waServiceTenantId ||
      !existing.waServiceApiKey ||
      !existing.waServiceWebhookSecret
    ) {
      throw new BadRequestException(
        "WhatsApp belum di-setup. Admin perlu create tenant di wa-service UI " +
          "lalu input credentials lewat POST /whatsapp-receipt/setup.",
      );
    }
    return {
      tenantId: existing.waServiceTenantId,
      apiKey: existing.waServiceApiKey,
      webhookSecret: existing.waServiceWebhookSecret,
    };
  }

  private async cacheSnapshot(
    companyId: string,
    data: WaServiceSession,
  ): Promise<void> {
    await this.prisma.whatsappSession.upsert({
      where: { companyId },
      create: {
        companyId,
        status: data.status,
        stage: data.stage,
        phoneNumber: data.phoneNumber,
        deviceName: data.deviceName,
        qrCode: data.qrCode,
        lastConnectedAt: data.lastConnectedAt
          ? new Date(data.lastConnectedAt)
          : null,
        lastDisconnectedAt: data.lastDisconnectedAt
          ? new Date(data.lastDisconnectedAt)
          : null,
        lastError: data.lastError,
      },
      update: {
        status: data.status,
        stage: data.stage,
        phoneNumber: data.phoneNumber,
        deviceName: data.deviceName,
        qrCode: data.qrCode,
        lastConnectedAt: data.lastConnectedAt
          ? new Date(data.lastConnectedAt)
          : null,
        lastDisconnectedAt: data.lastDisconnectedAt
          ? new Date(data.lastDisconnectedAt)
          : null,
        lastError: data.lastError,
      },
    });
  }

  private toSessionView(data: WaServiceSession): SessionView {
    return {
      status: data.status,
      stage: data.stage,
      phoneNumber: data.phoneNumber,
      deviceName: data.deviceName,
      qrCode: data.qrCode,
      lastConnectedAt: data.lastConnectedAt,
      lastDisconnectedAt: data.lastDisconnectedAt,
      lastError: data.lastError,
    };
  }

  private async snapshotFromDb(companyId: string): Promise<SessionView> {
    const row = await this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: {
        status: true,
        stage: true,
        phoneNumber: true,
        deviceName: true,
        qrCode: true,
        lastConnectedAt: true,
        lastDisconnectedAt: true,
        lastError: true,
      },
    });
    return {
      status: (row?.status ?? "DISCONNECTED") as SessionStatus,
      stage: (row?.stage ?? "IDLE") as SessionStage,
      phoneNumber: row?.phoneNumber ?? null,
      deviceName: row?.deviceName ?? null,
      qrCode: row?.qrCode ?? null,
      lastConnectedAt: row?.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectedAt: row?.lastDisconnectedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }
}

// Re-export helpers for backward compatibility — external consumers that
// import `normalizePhone` or `formatRupiah` from this file will still work.
export { normalizePhone, formatRupiah } from "./whatsapp-receipt.helpers";
