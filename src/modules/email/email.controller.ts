import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { EmailService } from "./email.service";
import { ReceiptEmailService } from "./receipt-email.service";
import {
  EmailReceiptSchema,
  EmailTransactionReceiptSchema,
  TestEmailSchema,
  type EmailReceiptDto,
  type EmailTransactionReceiptDto,
  type TestEmailDto,
} from "./dto/email.dto";
import { buildReceiptHtml } from "./receipt-template";

@ApiTags("Email")
@ApiBearerAuth()
@Controller("email")
@UseGuards(AccessGuard)
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly receiptEmail: ReceiptEmailService,
  ) {}

  @Get("status")
  @RequireAccess("settings", "view")
  @ApiOperation({ summary: "Cek apakah pengiriman email sudah dikonfigurasi" })
  status() {
    return {
      data: {
        configured: this.email.isConfigured(),
        sender: process.env.GMAIL_SENDER ?? null,
      },
    };
  }

  @Post("test")
  @RequireAccess("settings", "view")
  @ApiOperation({ summary: "Kirim email tes ke alamat tujuan" })
  @ApiZodBody(TestEmailSchema)
  async test(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TestEmailSchema)) body: TestEmailDto,
  ) {
    const subject = body.subject ?? "Tes Email MenoPOS";
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#1a1a1a">` +
      `<p>${escapeHtml(body.message ?? "Email tes dari MenoPOS berhasil terkirim. 🎉")}</p>` +
      `<hr style="border:none;border-top:1px solid #eee;margin:16px 0" />` +
      `<p style="color:#888;font-size:12px">Dikirim oleh pengguna ${escapeHtml(user.id)} via MenoPOS.</p>` +
      `</div>`;

    const result = await this.email.send({ to: body.to, subject, html });
    return { data: { success: true, messageId: result.id } };
  }

  @Post("receipt")
  @RequireAccess("pos", "view")
  @ApiOperation({ summary: "Kirim struk transaksi ke email pelanggan" })
  @ApiZodBody(EmailReceiptSchema)
  async receipt(
    @Body(new ZodValidationPipe(EmailReceiptSchema)) body: EmailReceiptDto,
  ) {
    const store = body.storeName?.trim() || "MenoPOS";
    const subject = `Struk ${store} — ${body.invoiceNumber}`;
    const html = buildReceiptHtml(body);
    const result = await this.email.send({ to: body.to, subject, html });
    return { data: { success: true, messageId: result.id } };
  }

  @Post("transaction/:id/receipt")
  @RequireAccess("transactions", "view")
  @ApiOperation({ summary: "Kirim struk transaksi tersimpan (by id) ke email" })
  @ApiZodBody(EmailTransactionReceiptSchema)
  async transactionReceipt(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EmailTransactionReceiptSchema))
    body: EmailTransactionReceiptDto,
  ) {
    const result = await this.receiptEmail.sendForTransaction(
      companyId,
      id,
      body.to,
    );
    return { data: { success: true, messageId: result.id } };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
