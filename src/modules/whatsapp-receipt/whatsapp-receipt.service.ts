import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";
import { WaServiceClient } from "../../common/wa-service/wa-service.client";
import type {
  WaServiceInboundEvent,
  WaServiceSession,
  WaServiceSessionStage,
} from "../../common/wa-service/wa-service.types";
import { WaServiceSocketService } from "./wa-service-socket.service";

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

  // ─── Outbound messages ─────────────────────────────────────────────
  async sendText(
    companyId: string,
    phone: string,
    message: string,
  ): Promise<{ success: true; messageId?: string }> {
    const creds = await this.ensureTenantCredentials(companyId);
    const normalizedPhone = normalizePhone(phone);
    const session = await this.ensureLocalSession(companyId);
    try {
      const result = await this.wa.sendText(
        creds.apiKey,
        normalizedPhone,
        message,
      );
      await this.prisma.whatsappMessageLog.create({
        data: {
          sessionId: session.id,
          direction: "OUTBOUND",
          toNumber: normalizedPhone,
          messageType: "text",
          content: message,
          status: result.status || "SENT",
          providerMessageId: result.providerMessageId,
        },
      });
      return { success: true, messageId: result.messageId };
    } catch (err) {
      const msg = (err as Error).message;
      await this.prisma.whatsappMessageLog.create({
        data: {
          sessionId: session.id,
          direction: "OUTBOUND",
          toNumber: normalizedPhone,
          messageType: "text",
          content: message,
          status: "FAILED",
          errorMessage: msg.slice(0, 500),
        },
      });
      // Surface error pakai exception sama seperti perilaku lama supaya
      // controller / caller bisa convert ke HTTP error yang sesuai.
      if (/belum aktif|tidak ditemukan|404/i.test(msg)) {
        throw new NotFoundException(msg);
      }
      throw new BadRequestException(msg);
    }
  }

  // Untuk kompatibilitas dengan chatbot yang kirim balasan pakai remoteJid
  // (mendukung @lid). Kita extract bagian sebelum '@' lalu treat sebagai
  // phone. Catatan: untuk @lid (LID anonymous, contact belum tersimpan di
  // pengirim), delivery via wa-service masih best-effort sama seperti dulu.
  async sendTextToJid(
    companyId: string,
    jidOrPhone: string,
    message: string,
  ): Promise<{ success: true; messageId?: string }> {
    const cleaned = jidOrPhone.includes("@")
      ? jidOrPhone.split("@")[0]?.split(":")[0] ?? jidOrPhone
      : jidOrPhone;
    return this.sendText(companyId, cleaned, message);
  }

  async sendReceipt(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<{ success: true; messageId?: string }> {
    const text = await this.generateReceiptText(companyId, transactionId);
    return this.sendText(companyId, phone, text);
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

  // ─── Message log query (lokal — wa-service tidak simpan history) ──
  async listMessages(
    companyId: string,
    opts: {
      limit?: number;
      cursor?: string;
      phone?: string;
      direction?: "INBOUND" | "OUTBOUND";
    } = {},
  ) {
    const session = await this.ensureLocalSession(companyId);
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

    const where: Record<string, unknown> = { sessionId: session.id };
    if (opts.direction) where.direction = opts.direction;
    if (opts.phone) {
      const cleaned = opts.phone.replace(/[^\d]/g, "");
      where.OR = [
        { fromNumber: { contains: cleaned } },
        { toNumber: { contains: cleaned } },
      ];
    }

    const items = await this.prisma.whatsappMessageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const slice = hasMore ? items.slice(0, limit) : items;

    // Enrichment: cocokkan peer phone ke User / Customer + ambil session meta.
    const peers = new Set<string>();
    for (const it of slice) {
      const peer = it.direction === "OUTBOUND" ? it.toNumber : it.fromNumber;
      if (peer) peers.add(peer);
    }
    const phoneVariants = (raw: string): string[] => {
      const digits = raw.replace(/[^\d]/g, "");
      const variants = new Set<string>();
      variants.add(raw);
      variants.add(digits);
      if (digits.startsWith("62")) {
        variants.add("0" + digits.slice(2));
        variants.add("+" + digits);
      } else if (digits.startsWith("0")) {
        variants.add("62" + digits.slice(1));
        variants.add("+62" + digits.slice(1));
      }
      return Array.from(variants);
    };
    const allVariants = new Set<string>();
    peers.forEach((p) => phoneVariants(p).forEach((v) => allVariants.add(v)));
    const variantList = Array.from(allVariants);

    const [users, customers, sessionMeta] = await Promise.all([
      variantList.length === 0
        ? Promise.resolve([])
        : this.prisma.user.findMany({
            where: { phone: { in: variantList } },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              phone: true,
              company: { select: { id: true, name: true } },
            },
          }),
      variantList.length === 0
        ? Promise.resolve([])
        : this.prisma.customer.findMany({
            where: { phone: { in: variantList } },
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              memberLevel: true,
              company: { select: { id: true, name: true } },
            },
          }),
      this.prisma.whatsappSession.findUnique({
        where: { id: session.id },
        select: {
          companyId: true,
          phoneNumber: true,
          deviceName: true,
          status: true,
          company: { select: { name: true } },
        },
      }),
    ]);

    const normalize = (raw: string | null | undefined): string => {
      if (!raw) return "";
      const d = raw.replace(/[^\d]/g, "");
      if (d.startsWith("0")) return "62" + d.slice(1);
      return d;
    };
    const userByPhone = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      const k = normalize(u.phone);
      if (k) userByPhone.set(k, u);
    }
    const customerByPhone = new Map<string, (typeof customers)[number]>();
    for (const c of customers) {
      const k = normalize(c.phone);
      if (k) customerByPhone.set(k, c);
    }

    return {
      session: sessionMeta
        ? {
            companyId: sessionMeta.companyId,
            companyName: sessionMeta.company?.name ?? null,
            phoneNumber: sessionMeta.phoneNumber,
            deviceName: sessionMeta.deviceName,
            status: sessionMeta.status,
          }
        : null,
      items: slice.map((it) => {
        const peer = it.direction === "OUTBOUND" ? it.toNumber : it.fromNumber;
        const peerNorm = normalize(peer);
        const matchedUser = peerNorm ? userByPhone.get(peerNorm) ?? null : null;
        const matchedCustomer = peerNorm
          ? customerByPhone.get(peerNorm) ?? null
          : null;

        return {
          id: it.id,
          direction: it.direction,
          toNumber: it.toNumber,
          fromNumber: it.fromNumber,
          peer,
          messageType: it.messageType,
          content: it.content,
          status: it.status,
          providerMessageId: it.providerMessageId,
          errorMessage: it.errorMessage,
          createdAt: it.createdAt.toISOString(),
          user: matchedUser
            ? {
                id: matchedUser.id,
                name: matchedUser.name,
                email: matchedUser.email,
                role: matchedUser.role,
                companyId: matchedUser.company?.id ?? null,
                companyName: matchedUser.company?.name ?? null,
              }
            : null,
          customer: matchedCustomer
            ? {
                id: matchedCustomer.id,
                name: matchedCustomer.name,
                email: matchedCustomer.email,
                memberLevel: matchedCustomer.memberLevel,
                companyId: matchedCustomer.company?.id ?? null,
                companyName: matchedCustomer.company?.name ?? null,
              }
            : null,
        };
      }),
      nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
    };
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

  // Pastikan row WhatsappSession ada (untuk simpan log pesan via FK).
  // Sebelum berhasil provisioning tenant credentials biasanya
  // ensureTenantCredentials sudah upsert row — tapi handleInbound bisa kena
  // race kalau row baru tanpa credentials. Defensive saja.
  private async ensureLocalSession(
    companyId: string,
  ): Promise<{ id: string }> {
    const row = await this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: { id: true },
    });
    if (row) return row;
    return this.prisma.whatsappSession.create({
      data: { companyId },
      select: { id: true },
    });
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

// ═══ Helpers (no Baileys) ═════════════════════════════════════════════

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

type ReceiptConfigShape = {
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

type ReceiptItemData = {
  name: string;
  qty: number;
  unitName: string | null;
  unitPrice: number;
  subtotal: number;
  discount: number;
  notes: string | null;
};

type ReceiptTransactionData = {
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

function buildThermalReceiptText(input: {
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
  const FIG = " ";
  const fixed = lines.map((ln) => {
    const padded = ln.length >= W ? ln : ln + FIG.repeat(W - ln.length);
    return padded.replace(/ /g, FIG);
  });

  return "```\n" + fixed.join("\n") + "\n```";
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

// formatRupiah dipakai di tempat lain? Tidak — internal only. Tapi tetap
// di-export jaga-jaga untuk caller eksternal yang sudah pakai.
export { formatRupiah };
