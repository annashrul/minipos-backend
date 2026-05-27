import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { Public } from "@/modules/auth/public.decorator";
import { verifyWaSignature } from "@/common/wa-service/wa-service.signature";
import type {
  WaServiceEventEnvelope,
  WaServiceInboundEvent,
  WaServiceSession,
} from "@/common/wa-service/wa-service.types";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";

// Endpoint diakses oleh wa-service (server-to-server) — TIDAK pakai JWT guard.
// Authentikasi via HMAC SHA-256 signature pada header X-Wa-Signature.
// Path final di backend (dengan prefix /api) jadi:
//   POST /api/whatsapp/webhook/inbound
//   POST /api/whatsapp/webhook/session
@Public()
@Controller("whatsapp/webhook")
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receipt: WhatsappReceiptService,
  ) {}

  @Post("inbound")
  @HttpCode(200)
  async inbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-wa-tenant-id") tenantId: string | undefined,
    @Headers("x-wa-signature") signature: string | undefined,
    @Body() body: WaServiceEventEnvelope<WaServiceInboundEvent>,
  ): Promise<{ ok: true }> {
    await this.verify(req, tenantId, signature);
    await this.receipt.handleInboundWebhook(tenantId!, body.data);
    return { ok: true };
  }

  @Post("session")
  @HttpCode(200)
  async session(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-wa-tenant-id") tenantId: string | undefined,
    @Headers("x-wa-signature") signature: string | undefined,
    @Body() body: WaServiceEventEnvelope<WaServiceSession>,
  ): Promise<{ ok: true }> {
    await this.verify(req, tenantId, signature);
    await this.receipt.handleSessionWebhook(tenantId!, body.data);
    return { ok: true };
  }

  // Resolve tenantId → companyId + webhookSecret, lalu verify signature
  // pakai raw body. Wajib raw body — JSON.stringify ulang dari `body` bisa
  // berbeda byte-for-byte dari payload asli wa-service (whitespace, key order).
  private async verify(
    req: RawBodyRequest<Request>,
    tenantId: string | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException("X-Wa-Tenant-Id header missing");
    }
    if (!signature) {
      throw new UnauthorizedException("X-Wa-Signature header missing");
    }
    const session = await this.prisma.whatsappSession.findUnique({
      where: { waServiceTenantId: tenantId },
      select: { companyId: true, waServiceWebhookSecret: true },
    });
    if (!session?.waServiceWebhookSecret) {
      this.logger.warn(
        `Webhook diterima untuk tenant tidak dikenal: ${tenantId}`,
      );
      throw new UnauthorizedException("Unknown tenant");
    }
    const raw = req.rawBody?.toString("utf8");
    if (!raw) {
      throw new BadRequestException("Raw body unavailable");
    }
    const ok = verifyWaSignature(raw, signature, session.waServiceWebhookSecret);
    if (!ok) {
      this.logger.warn(`Signature mismatch untuk tenant ${tenantId}`);
      throw new UnauthorizedException("Invalid signature");
    }
  }
}
