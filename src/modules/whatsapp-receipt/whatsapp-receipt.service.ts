import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
  WASocket,
} from "@whiskeysockets/baileys";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { waDebugLogSync } from "./wa-debug.logger";

/**
 * Generates digital receipt text for a transaction and a wa.me link.
 * The actual sending happens client-side by opening the wa.me URL in a new tab.
 *
 * Currently a thin proxy/builder. If a real WA gateway (e.g. Fonnte, Wablas,
 * Twilio) is added later, expose a `send()` method here.
 */
type SessionStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

type SessionView = {
  status: SessionStatus;
  phoneNumber: string | null;
  deviceName: string | null;
  qrCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
};

type BaileysModule = typeof import("@whiskeysockets/baileys");

type BaileysRuntime = {
  makeWASocket: BaileysModule["default"];
  Browsers: BaileysModule["Browsers"];
  DisconnectReason: BaileysModule["DisconnectReason"];
  fetchLatestBaileysVersion: BaileysModule["fetchLatestBaileysVersion"];
  initAuthCreds: BaileysModule["initAuthCreds"];
  proto: BaileysModule["proto"];
};

// Baileys v7 adalah ESM-only. tsconfig backend pakai `module: "commonjs"`,
// jadi TypeScript meng-emit `await import(...)` jadi `require(...)` —
// itu meledak dengan ERR_REQUIRE_ESM. Trik `new Function` membuat dynamic
// import lolos transpilasi sehingga tetap dieksekusi sebagai native ESM
// `import()` saat runtime.
const dynamicImport = new Function("specifier", "return import(specifier)") as <
  T = unknown,
>(
  specifier: string,
) => Promise<T>;

// ─── Buffer-aware JSON helpers ─────────────────────────────────────
// Baileys auth creds menyimpan key material sebagai `Buffer` / `Uint8Array`.
// Prisma `Json` column tidak preserve type info, jadi serialize manual
// ke marker `{type:"Buffer",data:[byte[]]}` dan revive saat dibaca.
function bufferReplacer(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    // Sudah ter-marker — biarkan lewat tanpa double-wrap.
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", data: Array.from(value) };
  }
  if (value instanceof Uint8Array) {
    return { type: "Buffer", data: Array.from(value) };
  }
  return value;
}

function bufferReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

@Injectable()
export class WhatsappReceiptService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsappReceiptService.name);
  private readonly sockets = new Map<string, WASocket>();
  private baileysRuntime: BaileysRuntime | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Restore semua sesi yang status CONNECTED + punya authCreds saat startup.
   * Tanpa ini, socket di Map hilang setiap kali Node restart (nodemon hot-
   * reload, deploy baru, dst.) padahal DB masih CONNECTED → user dipaksa
   * reconnect + scan ulang QR. Dengan creds tersimpan, Baileys langsung
   * resume tanpa QR.
   */
  async onModuleInit(): Promise<void> {
    try {
      const sessions = await this.prisma.whatsappSession.findMany({
        where: {
          status: "CONNECTED",
          authCreds: { not: Prisma.JsonNull },
        },
        select: { companyId: true },
      });
      if (sessions.length === 0) return;
      this.logger.log(
        `[wa] auto-restore ${sessions.length} session(s) on startup`,
      );
      waDebugLogSync({
        event: "module.init.restore",
        count: sessions.length,
        companies: sessions.map((s) => s.companyId),
      });
      for (const s of sessions) {
        // fire-and-forget — startup tidak boleh block boot kalau WA bermasalah
        this.connect(s.companyId, false).catch((err: unknown) => {
          this.logger.warn(
            `Auto-restore WA failed company=${s.companyId}: ${
              err instanceof Error ? err.message : "Unknown"
            }`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `onModuleInit WA scan failed: ${
          err instanceof Error ? err.message : "Unknown"
        }`,
      );
    }
  }

  private async getBaileysRuntime(): Promise<BaileysRuntime> {
    if (this.baileysRuntime) return this.baileysRuntime;
    // Dynamic import via `new Function` membuat namespace ESM. Default
    // export bisa nested ({ default: { default: fn } }) tergantung
    // bagaimana bundler Baileys ekspor — handle dua-duanya.
    const mod = (await dynamicImport<BaileysModule & { default: unknown }>(
      "@whiskeysockets/baileys",
    )) as Record<string, unknown>;
    const ns = (
      mod.default && typeof mod.default === "object"
        ? (mod.default as Record<string, unknown>)
        : mod
    ) as Record<string, unknown>;

    const makeWASocket =
      typeof ns.default === "function"
        ? (ns.default as BaileysModule["default"])
        : typeof ns.makeWASocket === "function"
          ? (ns.makeWASocket as unknown as BaileysModule["default"])
          : (mod.default as BaileysModule["default"]);

    if (typeof makeWASocket !== "function") {
      this.logger.error(
        `Baileys default export bukan function. Keys: ${Object.keys(ns).join(",")}`,
      );
      throw new Error("Baileys makeWASocket tidak ditemukan dari modul");
    }

    const pick = <T>(key: string): T =>
      (ns[key] ?? (mod as Record<string, unknown>)[key]) as T;

    this.baileysRuntime = {
      makeWASocket,
      Browsers: pick<BaileysModule["Browsers"]>("Browsers"),
      DisconnectReason:
        pick<BaileysModule["DisconnectReason"]>("DisconnectReason"),
      fetchLatestBaileysVersion: pick<
        BaileysModule["fetchLatestBaileysVersion"]
      >("fetchLatestBaileysVersion"),
      initAuthCreds: pick<BaileysModule["initAuthCreds"]>("initAuthCreds"),
      proto: pick<BaileysModule["proto"]>("proto"),
    };
    return this.baileysRuntime;
  }

  async onModuleDestroy(): Promise<void> {
    for (const [companyId, sock] of this.sockets.entries()) {
      try {
        sock.end(new Error("App shutdown"));
      } catch {
        this.logger.warn(`Failed ending WA socket for company=${companyId}`);
      }
    }
    this.sockets.clear();
  }

  async getSession(companyId: string): Promise<SessionView> {
    const row = await this.ensureSession(companyId);
    waDebugLogSync({
      event: "getSession",
      companyId,
      status: row.status,
      hasQr: Boolean(row.qrCode),
      qrLen: row.qrCode?.length ?? 0,
      phoneNumber: row.phoneNumber,
      lastError: row.lastError,
      hasCreds: row.authCreds !== null,
    });
    return this.toSessionView(row);
  }

  async connect(
    companyId: string,
    forceReconnect = false,
  ): Promise<SessionView> {
    const existingSock = this.sockets.get(companyId);
    const session0 = await this.ensureSession(companyId);
    const isStaleConnecting =
      session0.status === "CONNECTING" && !session0.qrCode;
    waDebugLogSync({
      event: "connect.enter",
      companyId,
      forceReconnect,
      dbStatus: session0.status,
      hasSocket: Boolean(existingSock),
      hasCreds: session0.authCreds !== null,
      isStaleConnecting,
    });
    // Short-circuit hanya kalau benar-benar connected; kalau status CONNECTING
    // tanpa QR (mis. backend restart, socket lama mati silent), force re-create.
    if (existingSock && !forceReconnect && session0.status === "CONNECTED") {
      return this.toSessionView(session0);
    }
    if (existingSock || isStaleConnecting) {
      if (existingSock) {
        try {
          existingSock.end(new Error("Reconnect requested"));
        } catch {
          /* noop */
        }
        this.sockets.delete(companyId);
      }
    }

    const session = session0;
    const baileys = await this.getBaileysRuntime();
    const auth = await this.buildAuthState(
      session.id,
      session.authCreds as Record<string, unknown> | null,
    );
    const { version } = await baileys.fetchLatestBaileysVersion();
    waDebugLogSync({
      event: "connect.makeSocket",
      companyId,
      baileysVersion: version.join("."),
      hasCreds: session.authCreds !== null,
    });
    // Pakai `Browsers.ubuntu("Chrome")` — string identifier yang dikenal
    // protocol WhatsApp.
    // markOnlineOnConnect: TRUE — kalau false, server WA menganggap device
    // offline & sendMessage hang menunggu ACK forever. Wajib true untuk
    // outbound message yang reliable.
    const sock = baileys.makeWASocket({
      version,
      auth,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      browser: baileys.Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 45_000,
    });
    this.sockets.set(companyId, sock);

    await this.prisma.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: "CONNECTING",
        qrCode: null,
        lastError: null,
      },
    });

    // Track inbound + ack events untuk diagnose sendMessage hang.
    sock.ev.on("messages.upsert", (m) => {
      waDebugLogSync({
        event: "messages.upsert",
        companyId,
        type: m.type,
        count: m.messages.length,
        firstFrom: m.messages[0]?.key.remoteJid,
        firstFromMe: m.messages[0]?.key.fromMe,
        firstId: m.messages[0]?.key.id,
      });
    });
    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        waDebugLogSync({
          event: "messages.update",
          companyId,
          jid: u.key.remoteJid,
          id: u.key.id,
          status: u.update.status,
        });
      }
    });

    sock.ev.on("creds.update", async () => {
      // PENTING: parameter event di Baileys v7 hanya partial-delta — TIDAK
      // berisi full creds. Ambil dari `auth.creds` (referensi yang Baileys
      // mutate in-place) — itu always full state setelah update.
      const fullCreds = auth.creds as Record<string, unknown>;
      const noiseKey = fullCreds.noiseKey as
        | { public?: unknown; private?: unknown }
        | undefined;
      waDebugLogSync({
        event: "creds.update",
        companyId,
        source: "auth.creds (full)",
        hasNoiseKey: Boolean(noiseKey),
        noisePublicType: noiseKey?.public
          ? typeof noiseKey.public === "object"
            ? Buffer.isBuffer(noiseKey.public)
              ? "Buffer"
              : noiseKey.public instanceof Uint8Array
                ? "Uint8Array"
                : "object"
            : typeof noiseKey.public
          : "missing",
        registrationId: fullCreds.registrationId,
        platform: fullCreds.platform,
        meHasId: Boolean((fullCreds.me as { id?: string } | undefined)?.id),
      });
      await this.prisma.whatsappSession.update({
        where: { id: session.id },
        data: { authCreds: this.toDbJson(auth.creds) },
      });
    });

    // Resolve segera setelah event `qr` pertama / connection open / close —
    // pakai untuk wait pendek (max 3.5s) supaya response `connect()` sudah
    // bawa QR di banyak kasus. Tapi tidak block kelamaan: kalau Baileys
    // butuh waktu lebih, biarkan polling frontend ambil QR.
    let resolveFirstQr: ((value: void) => void) | null = null;
    const firstQrPromise = new Promise<void>((resolve) => {
      resolveFirstQr = resolve;
    });

    sock.ev.on("connection.update", async (update) => {
      const {
        connection,
        lastDisconnect,
        qr,
        isNewLogin,
        receivedPendingNotifications,
      } = update;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errAny = lastDisconnect?.error as any;
      waDebugLogSync({
        event: "connection.update",
        companyId,
        connection: connection ?? null,
        qr: qr ? { len: qr.length, preview: qr.slice(0, 20) + "..." } : null,
        isNewLogin: isNewLogin ?? null,
        receivedPendingNotifications: receivedPendingNotifications ?? null,
        disconnect: lastDisconnect
          ? {
              message: lastDisconnect.error?.message,
              statusCode:
                errAny?.output?.statusCode ?? errAny?.statusCode ?? null,
              stack: lastDisconnect.error?.stack?.split("\n").slice(0, 3),
            }
          : null,
      });
      if (qr) {
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: {
            status: "CONNECTING",
            qrCode: qr,
            lastError: null,
          },
        });
        if (resolveFirstQr) {
          resolveFirstQr();
          resolveFirstQr = null;
        }
      }

      if (connection === "open") {
        const phone = extractPhoneFromJid(sock.user?.id);
        waDebugLogSync({
          event: "scan.success",
          companyId,
          phoneNumber: phone,
          deviceName: sock.user?.name ?? null,
          userJid: sock.user?.id,
        });
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: {
            status: "CONNECTED",
            qrCode: null,
            phoneNumber: phone,
            deviceName: sock.user?.name ?? null,
            lastConnectedAt: new Date(),
            lastError: null,
          },
        });
        if (resolveFirstQr) {
          resolveFirstQr();
          resolveFirstQr = null;
        }
      }

      if (connection === "close") {
        const statusCode = Number(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lastDisconnect?.error as any)?.output?.statusCode ??
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (lastDisconnect?.error as any)?.statusCode ??
            0,
        );
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        const reason = lastDisconnect?.error?.message || "Disconnected";

        waDebugLogSync({
          event: "connection.close",
          companyId,
          statusCode,
          loggedOut,
          reason,
          willAutoReconnect: !loggedOut,
        });

        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: {
            status: "DISCONNECTED",
            qrCode: null,
            lastDisconnectedAt: new Date(),
            lastError: reason,
          },
        });
        this.sockets.delete(companyId);
        if (resolveFirstQr) {
          resolveFirstQr();
          resolveFirstQr = null;
        }

        if (!loggedOut) {
          setTimeout(() => {
            this.connect(companyId, false).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : "Unknown error";
              this.logger.warn(
                `Auto reconnect failed company=${companyId}: ${msg}`,
              );
            });
          }, 2_000);
        }
      }
    });

    // Wait pendek (max 3.5 detik) agar response sudah bawa QR di banyak
    // kasus — tapi tidak block kelamaan: frontend juga polling 1.5s untuk
    // pickup QR/status berikutnya secara cepat.
    const t0 = Date.now();
    await Promise.race([
      firstQrPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 3_500)),
    ]);
    const waitMs = Date.now() - t0;

    const latest = await this.ensureSession(companyId);
    waDebugLogSync({
      event: "connect.return",
      companyId,
      waitMs,
      status: latest.status,
      hasQr: Boolean(latest.qrCode),
      qrLen: latest.qrCode?.length ?? 0,
      lastError: latest.lastError,
    });
    return this.toSessionView(latest);
  }

  async disconnect(companyId: string): Promise<SessionView> {
    const session = await this.ensureSession(companyId);
    const sock = this.sockets.get(companyId);
    if (sock) {
      try {
        sock.end(new Error("Disconnected by user"));
      } catch {
        /* noop */
      }
      this.sockets.delete(companyId);
    }
    await this.prisma.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: "DISCONNECTED",
        qrCode: null,
        lastDisconnectedAt: new Date(),
      },
    });
    const latest = await this.ensureSession(companyId);
    return this.toSessionView(latest);
  }

  async logout(companyId: string): Promise<SessionView> {
    const session = await this.ensureSession(companyId);
    const sock = this.sockets.get(companyId);
    if (sock) {
      try {
        sock.logout();
      } catch {
        /* noop */
      }
      try {
        sock.end(new Error("Logged out"));
      } catch {
        /* noop */
      }
      this.sockets.delete(companyId);
    }
    await this.prisma.$transaction([
      this.prisma.whatsappSessionKey.deleteMany({
        where: { sessionId: session.id },
      }),
      this.prisma.whatsappSession.update({
        where: { id: session.id },
        data: {
          status: "DISCONNECTED",
          qrCode: null,
          authCreds: Prisma.JsonNull,
          phoneNumber: null,
          deviceName: null,
          lastDisconnectedAt: new Date(),
          lastError: null,
        },
      }),
    ]);
    const latest = await this.ensureSession(companyId);
    return this.toSessionView(latest);
  }

  async sendText(
    companyId: string,
    phone: string,
    message: string,
  ): Promise<{ success: true; messageId?: string }> {
    let session = await this.ensureSession(companyId);
    let sock = this.sockets.get(companyId);
    waDebugLogSync({
      event: "sendText.enter",
      companyId,
      hasSocket: Boolean(sock),
      sessionStatus: session.status,
      phoneRaw: phone,
      messageLen: message.length,
      socketUserJid: sock?.user?.id ?? null,
      wsState: sock
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((sock as any).ws?.readyState ?? null)
        : null,
    });

    // Recover transparent kalau socket hilang dari memori (mis. setelah
    // backend restart) tapi creds masih tersimpan di DB. Reconnect dulu,
    // baru kirim — user tidak perlu klik "Hubungkan" manual.
    if (!sock && session.authCreds !== null) {
      waDebugLogSync({
        event: "sendText.autoReconnect",
        companyId,
        reason: "socket missing, creds available",
      });
      try {
        await this.connect(companyId, false);
      } catch (err) {
        waDebugLogSync({
          event: "sendText.autoReconnect.error",
          companyId,
          msg: err instanceof Error ? err.message : "unknown",
        });
      }
      // Tunggu sampai 12 detik untuk socket open (poll status setiap 500ms).
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 500));
        sock = this.sockets.get(companyId);
        session = await this.ensureSession(companyId);
        if (sock && session.status === "CONNECTED") break;
      }
    }

    if (!sock) {
      throw new NotFoundException(
        "Koneksi WhatsApp belum aktif. Silakan connect terlebih dahulu.",
      );
    }
    if (session.status !== "CONNECTED") {
      throw new BadRequestException(
        `Sesi belum siap (status: ${session.status}). Tunggu hingga CONNECTED.`,
      );
    }

    const normalizedPhone = normalizePhone(phone);
    const jid = `${normalizedPhone}@s.whatsapp.net`;

    // Reject self-send — WhatsApp tidak deliver pesan ke device yang sama
    // dengan pengirim, jadi Baileys hang menunggu ACK forever.
    const ownPhone = extractPhoneFromJid(sock.user?.id);
    if (ownPhone && ownPhone === normalizedPhone) {
      waDebugLogSync({
        event: "sendText.rejected",
        companyId,
        reason: "self-send",
        ownPhone,
        targetPhone: normalizedPhone,
      });
      throw new BadRequestException(
        "Tidak bisa kirim pesan ke nomor sendiri. Gunakan nomor lain untuk tes.",
      );
    }

    // Verifikasi nomor target benar-benar terdaftar di WhatsApp.
    try {
      const check = await Promise.race([
        sock.onWhatsApp(normalizedPhone),
        new Promise<undefined>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout cek nomor WhatsApp")),
            10_000,
          ),
        ),
      ]);
      const isOnWa = Array.isArray(check) && check[0]?.exists === true;
      waDebugLogSync({
        event: "sendText.onWhatsApp",
        companyId,
        normalizedPhone,
        result: check,
        isOnWa,
      });
      if (!isOnWa) {
        throw new BadRequestException(
          `Nomor ${normalizedPhone} tidak terdaftar di WhatsApp.`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : "onWhatsApp error";
      waDebugLogSync({
        event: "sendText.onWhatsApp.error",
        companyId,
        msg,
      });
      // Lanjutkan walaupun cek nomor gagal — beri kesempatan sendMessage
      // tetap dicoba (timeout 25 detik akan tangkap kalau tidak deliver).
    }

    // Kalau scan baru < 8 detik, beri waktu Baileys upload pre-keys ke
    // server WA — sendMessage sebelum itu bisa hang menunggu key bundle.
    if (session.lastConnectedAt) {
      const sinceConnect = Date.now() - session.lastConnectedAt.getTime();
      if (sinceConnect < 8_000) {
        const wait = 8_000 - sinceConnect;
        waDebugLogSync({
          event: "sendText.warmup-wait",
          companyId,
          sinceConnectMs: sinceConnect,
          waitMs: wait,
        });
        await new Promise<void>((r) => setTimeout(r, wait));
      }
    }

    waDebugLogSync({
      event: "sendText.dispatch",
      companyId,
      jid,
      normalizedPhone,
    });

    const t0 = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error("Timeout: WhatsApp tidak merespons dalam 30 detik."),
          ),
        30_000,
      );
    });
    const sendPromise = sock.sendMessage(jid, { text: message });

    try {
      const res = await Promise.race([sendPromise, timeoutPromise]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const messageId = res?.key?.id || undefined;
      waDebugLogSync({
        event: "sendText.success",
        companyId,
        elapsedMs: Date.now() - t0,
        messageId,
        toJid: res?.key?.remoteJid ?? null,
      });
      await this.prisma.whatsappMessageLog.create({
        data: {
          sessionId: session.id,
          direction: "OUTBOUND",
          toNumber: normalizedPhone,
          messageType: "text",
          content: message,
          status: "SENT",
          providerMessageId: messageId ?? null,
        },
      });
      return { success: true, messageId };
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const errorMsg = err instanceof Error ? err.message : "Gagal mengirim";
      waDebugLogSync({
        event: "sendText.error",
        companyId,
        elapsedMs: Date.now() - t0,
        errorMsg,
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : null,
      });
      await this.prisma.whatsappMessageLog.create({
        data: {
          sessionId: session.id,
          direction: "OUTBOUND",
          toNumber: normalizedPhone,
          messageType: "text",
          content: message,
          status: "FAILED",
          errorMessage: errorMsg,
        },
      });
      throw err;
    }
  }

  async sendReceipt(
    companyId: string,
    transactionId: string,
    phone: string,
  ): Promise<{ success: true; messageId?: string }> {
    const text = await this.generateReceiptText(companyId, transactionId);
    return this.sendText(companyId, phone, text);
  }

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
        invoiceNumber: transaction.invoiceNumber,
        date: formatReceiptDate(transaction.createdAt),
        cashier: transaction.user.name,
        branch: transaction.branch?.name ?? null,
        customer: transaction.customer?.name ?? null,
        memberLevel: transaction.customer?.memberLevel ?? null,
        items: transaction.items.map((it) => ({
          name: it.productName,
          qty: it.quantity,
          unitName: it.unitName,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          discount: it.discount,
          notes: it.notes,
        })),
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

  /**
   * Ambil receipt config dari Settings (key prefix `receipt.*`). Branch-
   * specific dulu, fallback ke null branch (global), lalu default. Mirror
   * logic di frontend `getReceiptConfig`.
   */
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
    // Branch-specific override null branch.
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

  private async ensureSession(companyId: string) {
    const found = await this.prisma.whatsappSession.findUnique({
      where: { companyId },
    });
    if (found) return found;
    return this.prisma.whatsappSession.create({
      data: { companyId, status: "DISCONNECTED" },
    });
  }

  private toSessionView(
    row: Awaited<ReturnType<WhatsappReceiptService["ensureSession"]>>,
  ): SessionView {
    return {
      status: (row.status as SessionStatus) ?? "DISCONNECTED",
      phoneNumber: row.phoneNumber ?? null,
      deviceName: row.deviceName ?? null,
      qrCode: row.qrCode ?? null,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      lastDisconnectedAt: row.lastDisconnectedAt?.toISOString() ?? null,
      lastError: row.lastError ?? null,
    };
  }

  // Baileys creds berisi Buffer instances + Uint8Array. Prisma JSON column
  // serialize Buffer ke `{type:"Buffer",data:[...]}` tapi tidak revive saat
  // dibaca — harus manual. Implementasi independen dari `BufferJSON` Baileys
  // (yang export-nya inkonsisten antar versi/bundler — v7 RC kadang ekspor
  // sebagai property bukan callable).
  private toDbJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, bufferReplacer),
    ) as Prisma.InputJsonValue;
  }

  private fromDbJson<T>(value: unknown): T {
    return JSON.parse(JSON.stringify(value), bufferReviver) as T;
  }

  private async buildAuthState(
    sessionId: string,
    authCreds: Record<string, unknown> | null,
  ): Promise<AuthenticationState> {
    const baileys = await this.getBaileysRuntime();
    const creds = authCreds
      ? this.fromDbJson<AuthenticationCreds>(authCreds)
      : baileys.initAuthCreds();

    const keys: AuthenticationState["keys"] = {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ) => {
        const rows = await this.prisma.whatsappSessionKey.findMany({
          where: {
            sessionId,
            keyType: String(type),
            keyId: { in: ids },
          },
        });
        const out: Record<string, SignalDataTypeMap[T]> = {};
        for (const id of ids) {
          const row = rows.find((r) => r.keyId === id);
          if (!row) continue;
          const parsed = this.fromDbJson<SignalDataTypeMap[T]>(row.value);
          if (type === "app-state-sync-key") {
            out[id] = baileys.proto.Message.AppStateSyncKeyData.fromObject(
              parsed as Record<string, unknown>,
            ) as unknown as SignalDataTypeMap[T];
            continue;
          }
          out[id] = parsed;
        }
        return out;
      },
      set: async (
        data: Partial<{
          [T in keyof SignalDataTypeMap]: {
            [id: string]: SignalDataTypeMap[T] | null;
          };
        }>,
      ) => {
        const tx: Prisma.PrismaPromise<unknown>[] = [];
        for (const [keyType, entries] of Object.entries(data)) {
          if (!entries) continue;
          for (const [keyId, val] of Object.entries(entries)) {
            if (val) {
              tx.push(
                this.prisma.whatsappSessionKey.upsert({
                  where: {
                    sessionId_keyType_keyId: {
                      sessionId,
                      keyType,
                      keyId,
                    },
                  },
                  create: {
                    sessionId,
                    keyType,
                    keyId,
                    value: this.toDbJson(val),
                  },
                  update: {
                    value: this.toDbJson(val),
                  },
                }),
              );
            } else {
              tx.push(
                this.prisma.whatsappSessionKey.deleteMany({
                  where: { sessionId, keyType, keyId },
                }),
              );
            }
          }
        }
        if (tx.length > 0) {
          await this.prisma.$transaction(tx);
        }
      },
    };

    return { creds, keys };
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
    CASH: "Tunai",
    TRANSFER: "Transfer",
    QRIS: "QRIS",
    EWALLET: "E-Wallet",
    DEBIT: "Debit",
    CREDIT_CARD: "Kartu Kredit",
    TERMIN: "Termin",
  };
  return labels[method] || method;
}

// ─── Thermal-style receipt text builder ───────────────────────────
// Layout monospace agar di WhatsApp render rapi seperti struk kertas.
// Wrap dalam triple-backtick (code block) untuk memastikan font monospace
// di WA mobile & desktop.

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

  // Items — layout adaptif:
  //   - qty=1 tanpa diskon-item: `Name` ⇄ `subtotal` (1 baris, atau name di-
  //     wrap kalau panjang dengan subtotal di baris terakhir).
  //   - qty>1 atau unit non-default: nama di baris atas, lalu
  //     `qty UNIT x price` ⇄ `subtotal` di baris kedua.
  //   - Kalau qty-line + subtotal overflow lebar struk (mis. unit panjang
  //     "Dus (12 x 1L)"), pisah jadi 2 baris (qty-line sendiri + subtotal
  //     rata kanan) — ini mencegah `harga harga` keliatan kayak duplikat.
  const safeRow = (left: string, right: string) => {
    // 1 = minimal space pemisah
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
      // Layout ringkas: nama ⇄ subtotal. Kalau overflow, name di-wrap dan
      // subtotal di baris baru rata kanan.
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

    // Layout 2-baris: nama (bisa multi-line) + qty-line.
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

  // Totals
  lines.push(row("Subtotal", fmt(tx.subtotal)));
  if (tx.discountAmount > 0) {
    lines.push(row("Diskon", `-${fmt(tx.discountAmount)}`));
  }
  if (tx.taxAmount > 0) lines.push(row("Pajak", fmt(tx.taxAmount)));
  lines.push(rule("="));
  lines.push(row("TOTAL", `Rp ${fmt(tx.grandTotal)}`));
  lines.push(rule("="));

  // Payment
  if (input.showPaymentMethod) {
    const payments =
      tx.payments.length > 0
        ? tx.payments
        : [{ method: tx.paymentMethod, amount: tx.paymentAmount }];
    if (payments.length > 1) {
      lines.push("Pembayaran:");
      for (const p of payments) {
        lines.push(row(`  ${paymentMethodLabel(p.method)}`, `Rp ${fmt(p.amount)}`));
      }
      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      lines.push(row("  Total Bayar", `Rp ${fmt(totalPaid)}`));
    } else {
      const p = payments[0]!;
      lines.push(
        row(paymentMethodLabel(p.method), `Rp ${fmt(p.amount)}`),
      );
    }
  }
  if (tx.changeAmount > 0) {
    lines.push(row("Kembali", `Rp ${fmt(tx.changeAmount)}`));
  }

  // Promo
  if (tx.promoApplied) {
    lines.push(rule("-"));
    for (const ln of wrap(`Promo: ${tx.promoApplied}`)) lines.push(ln);
  }

  // Footer
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

  // Pakai U+2007 FIGURE SPACE — lebar persis = digit, NEVER di-collapse
  // oleh WA mobile/desktop. NBSP (U+00A0) ternyata juga di-collapse atau
  // di-render lebih sempit dari ASCII space di font monospace WA mobile.
  const FIG = " ";
  const fixed = lines.map((ln) => {
    const padded = ln.length >= W ? ln : ln + FIG.repeat(W - ln.length);
    // Replace SEMUA ASCII space dengan FIG agar lebar konsisten.
    return padded.replace(/ /g, FIG);
  });

  // Wrap dalam code block agar WA render monospace (alignment terjaga).
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

function extractPhoneFromJid(jid?: string | null): string | null {
  if (!jid) return null;
  const [raw] = jid.split(":");
  const phone = raw.split("@")[0] ?? "";
  return phone || null;
}
