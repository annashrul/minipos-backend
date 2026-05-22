import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import {
  WhatsAppBaileysConnectBodySchema,
  WhatsAppBaileysSendReceiptBodySchema,
  WhatsAppBaileysSendTextBodySchema,
  WhatsAppReceiptLinkQuerySchema,
  WhatsAppReceiptTextParamsSchema,
  type WhatsAppBaileysConnectBodyDto,
  type WhatsAppBaileysSendReceiptBodyDto,
  type WhatsAppBaileysSendTextBodyDto,
  type WhatsAppReceiptLinkQueryDto,
  type WhatsAppReceiptTextParamsDto,
} from "@/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { WhatsappCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { WhatsappReceiptService } from "./whatsapp-receipt.service";

// Setup credentials wa-service — admin minipos input setelah create tenant
// manual di wa-service UI. Inline schema (bukan dari @/contracts) supaya
// gampang iterate tanpa modif contracts package.
const WaServiceSetupBodySchema = z.object({
  tenantId: z.string().uuid({ message: "tenantId harus UUID dari wa-service" }),
  apiKey: z.string().regex(/^wask_/, "API key harus diawali 'wask_'"),
  webhookSecret: z.string().min(16, "webhookSecret terlalu pendek"),
});
type WaServiceSetupBodyDto = z.infer<typeof WaServiceSetupBodySchema>;

@Controller("whatsapp-receipt")
export class WhatsappReceiptController {
  constructor(private readonly receipt: WhatsappReceiptService) {}

  // ─── Setup wa-service credentials (per company) ────────────────
  @Get("setup")
  @RequireAccess("whatsapp-bot", "view")
  async getSetup(@WhatsappCompany() companyId: string) {
    const data = await this.receipt.getSetupStatus(companyId);
    return { data };
  }

  @Post("setup")
  @RequireAccess("whatsapp-bot", "update")
  async setup(
    @WhatsappCompany() companyId: string,
    @Body(new ZodValidationPipe(WaServiceSetupBodySchema))
    body: WaServiceSetupBodyDto,
  ) {
    const data = await this.receipt.setupCredentials(companyId, body);
    return { data };
  }

  @Delete("setup")
  @RequireAccess("whatsapp-bot", "update")
  async clearSetup(@WhatsappCompany() companyId: string) {
    await this.receipt.clearCredentials(companyId);
    return { data: { ok: true } };
  }

  @Get("baileys/session")
  async session(@WhatsappCompany() companyId: string) {
    const data = await this.receipt.getSession(companyId);
    return { data };
  }

  @Post("baileys/connect")
  async connect(
    @WhatsappCompany() companyId: string,
    @Body(new ZodValidationPipe(WhatsAppBaileysConnectBodySchema))
    body: WhatsAppBaileysConnectBodyDto,
  ) {
    const data = await this.receipt.connect(
      companyId,
      body.forceReconnect ?? false,
    );
    return { data };
  }

  @Post("baileys/disconnect")
  async disconnect(@WhatsappCompany() companyId: string) {
    const data = await this.receipt.disconnect(companyId);
    return { data };
  }

  @Post("baileys/logout")
  async logout(@WhatsappCompany() companyId: string) {
    const data = await this.receipt.logout(companyId);
    return { data };
  }

  @Post("baileys/send-text")
  async sendText(
    @WhatsappCompany() companyId: string,
    @Body(new ZodValidationPipe(WhatsAppBaileysSendTextBodySchema))
    body: WhatsAppBaileysSendTextBodyDto,
  ) {
    const data = await this.receipt.sendText(
      companyId,
      body.phone,
      body.message,
    );
    return { data };
  }

  @Post("baileys/send-receipt")
  @RequireAccess("transactions", "send_whatsapp")
  async sendReceipt(
    @WhatsappCompany() companyId: string,
    @Body(new ZodValidationPipe(WhatsAppBaileysSendReceiptBodySchema))
    body: WhatsAppBaileysSendReceiptBodyDto,
  ) {
    const data = await this.receipt.sendReceipt(
      companyId,
      body.transactionId,
      body.phone,
    );
    return { data };
  }

  @Get("text/:transactionId")
  async text(
    @WhatsappCompany() companyId: string,
    @Param(new ZodValidationPipe(WhatsAppReceiptTextParamsSchema))
    params: WhatsAppReceiptTextParamsDto,
  ) {
    const text = await this.receipt.generateReceiptText(
      companyId,
      params.transactionId,
    );
    return { data: { text } };
  }

  @Get("link")
  async link(
    @WhatsappCompany() companyId: string,
    @Query(new ZodValidationPipe(WhatsAppReceiptLinkQuerySchema))
    query: WhatsAppReceiptLinkQueryDto,
  ) {
    const url = await this.receipt.generateLink(
      companyId,
      query.transactionId,
      query.phone,
    );
    return { data: { url } };
  }

  @Get("messages")
  async messages(
    @WhatsappCompany() companyId: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
    @Query("phone") phone?: string,
    @Query("direction") direction?: string,
  ) {
    const limit = limitRaw ? Number(limitRaw) : 30;
    const data = await this.receipt.listMessages(companyId, {
      limit: Number.isFinite(limit) ? limit : 30,
      ...(cursor ? { cursor } : {}),
      ...(phone ? { phone } : {}),
      ...(direction === "INBOUND" || direction === "OUTBOUND"
        ? { direction }
        : {}),
    });
    return { data };
  }
}
