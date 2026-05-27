import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { WaServiceClient } from "@/common/wa-service/wa-service.client";
import { normalizePhone } from "./whatsapp-receipt.helpers";

@Injectable()
export class WhatsappMessageService {
  private readonly logger = new Logger(WhatsappMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa: WaServiceClient,
  ) {}

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

  // ─── Internal helpers ──────────────────────────────────────────────

  async ensureTenantCredentials(
    companyId: string,
  ): Promise<{ tenantId: string; apiKey: string; webhookSecret: string }> {
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
}
