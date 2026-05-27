import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { XenditEwalletService } from "./xendit/xendit-ewallet.service";
import { XenditInvoiceService } from "./xendit/xendit-invoice.service";
import { XenditQrService } from "./xendit/xendit-qr.service";
import { XenditVaService } from "./xendit/xendit-va.service";

const CreateInvoiceSchema = z.object({
  // Salah satu wajib: transactionId untuk link ke POS Transaction, atau
  // amount manual untuk one-off bill.
  transactionId: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  description: z.string().optional(),
  customer: z
    .object({
      name: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().int().positive(),
        price: z.number().int().nonnegative(),
        category: z.string().optional(),
      }),
    )
    .optional(),
  // Filter metode pembayaran di hosted page Xendit (mis. ["OVO","DANA","GOPAY"]).
  paymentMethods: z.array(z.string().min(1)).optional(),
});

const CreateQrSchema = z.object({
  transactionId: z.string().min(1).optional(),
  amount: z.number().int().positive(),
  description: z.string().optional(),
});

const EwalletChannelEnum = z.enum([
  "ID_OVO",
  "ID_DANA",
  "ID_SHOPEEPAY",
  "ID_LINKAJA",
  "ID_ASTRAPAY",
  "ID_JENIUSPAY",
]);

const CreateEwalletSchema = z.object({
  transactionId: z.string().min(1).optional(),
  amount: z.number().int().positive(),
  channelCode: EwalletChannelEnum,
  mobileNumber: z.string().min(8).optional(),
  description: z.string().optional(),
});

const VaBankEnum = z.enum([
  "BCA",
  "BNI",
  "BRI",
  "MANDIRI",
  "PERMATA",
  "BJB",
  "BSI",
  "CIMB",
  "SAHABAT_SAMPOERNA",
  "BNC",
]);

const CreateVaSchema = z.object({
  transactionId: z.string().min(1).optional(),
  amount: z.number().int().positive(),
  bankCode: VaBankEnum,
  customerName: z.string().min(1).max(50),
  description: z.string().optional(),
});

@Controller("payments")
@UseGuards(AccessGuard)
export class PaymentsController {
  constructor(
    private readonly xendit: XenditInvoiceService,
    private readonly xenditQr: XenditQrService,
    private readonly xenditEwallet: XenditEwalletService,
    private readonly xenditVa: XenditVaService,
  ) {}

  /** Create Xendit invoice. Frontend redirect customer ke `paymentUrl`. */
  @Post("xendit/invoices")
  @RequireAccess("pos", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateInvoiceSchema))
    body: z.infer<typeof CreateInvoiceSchema>,
  ) {
    if (!body.transactionId && !body.amount) {
      throw new Error("transactionId atau amount wajib diisi");
    }
    const order = await this.xendit.createForTransaction({
      companyId,
      transactionId: body.transactionId ?? null,
      amount: body.amount ?? 0,
      description: body.description ?? "",
      ...(body.customer ? { customer: body.customer } : {}),
      ...(body.items ? { items: body.items } : {}),
      ...(body.paymentMethods && body.paymentMethods.length > 0
        ? { paymentMethods: body.paymentMethods }
        : {}),
    });
    return { data: order };
  }

  /** Polling status — frontend bisa pakai sambil menunggu webhook. */
  @Get("xendit/invoices/:id")
  @RequireAccess("pos", "create")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const order = await this.xendit.findById(id, companyId);
    return { data: order };
  }

  /** Force-sync dari Xendit (kalau webhook belum sampai). */
  @Post("xendit/invoices/:id/sync")
  @RequireAccess("pos", "create")
  async sync(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const order = await this.xendit.syncFromProvider(id, companyId);
    return { data: order };
  }

  /** Create dynamic QR (QRIS) — UI pakai qr_string untuk render QR sendiri. */
  @Post("xendit/qr-codes")
  @RequireAccess("pos", "create")
  async createQr(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateQrSchema))
    body: z.infer<typeof CreateQrSchema>,
  ) {
    const { order, qrString } = await this.xenditQr.createForTransaction({
      companyId,
      transactionId: body.transactionId ?? null,
      amount: body.amount,
      description: body.description ?? "",
    });
    return {
      data: {
        id: order.id,
        externalId: order.externalId,
        providerOrderId: order.providerOrderId,
        status: order.status,
        amount: order.amount,
        expiresAt: order.expiresAt,
        qrString,
      },
    };
  }

  /** Polling status QR. */
  @Get("xendit/qr-codes/:id")
  @RequireAccess("pos", "create")
  async findQr(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const order = await this.xenditQr.findById(id, companyId);
    const raw = (order.rawCreate as Record<string, unknown> | null) ?? {};
    const qrString = typeof raw["qr_string"] === "string" ? (raw["qr_string"] as string) : null;
    return {
      data: {
        id: order.id,
        status: order.status,
        amount: order.amount,
        expiresAt: order.expiresAt,
        paidAt: order.paidAt,
        transactionId: order.transactionId,
        qrString,
      },
    };
  }

  /** Create E-Wallet charge — UI sendiri pilih channel (OVO/DANA/dll). */
  @Post("xendit/ewallet-charges")
  @RequireAccess("pos", "create")
  async createEwallet(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateEwalletSchema))
    body: z.infer<typeof CreateEwalletSchema>,
  ) {
    const { order, charge } = await this.xenditEwallet.createForTransaction({
      companyId,
      transactionId: body.transactionId ?? null,
      amount: body.amount,
      channelCode: body.channelCode,
      ...(body.mobileNumber ? { mobileNumber: body.mobileNumber } : {}),
      description: body.description ?? "",
    });
    return {
      data: {
        id: order.id,
        externalId: order.externalId,
        providerOrderId: order.providerOrderId,
        status: order.status,
        amount: order.amount,
        channelCode: charge.channel_code,
        isRedirectRequired: charge.is_redirect_required,
        actions: {
          desktopWebCheckoutUrl: charge.actions?.desktop_web_checkout_url ?? null,
          mobileWebCheckoutUrl: charge.actions?.mobile_web_checkout_url ?? null,
          mobileDeeplinkCheckoutUrl: charge.actions?.mobile_deeplink_checkout_url ?? null,
          qrCheckoutString: charge.actions?.qr_checkout_string ?? null,
        },
      },
    };
  }

  /** Polling status E-Wallet. */
  @Get("xendit/ewallet-charges/:id")
  @RequireAccess("pos", "create")
  async findEwallet(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const order = await this.xenditEwallet.findById(id, companyId);
    const raw = (order.rawCreate as Record<string, unknown> | null) ?? {};
    const actions = (raw["actions"] as Record<string, unknown> | undefined) ?? {};
    return {
      data: {
        id: order.id,
        status: order.status,
        amount: order.amount,
        paidAt: order.paidAt,
        transactionId: order.transactionId,
        channelCode: order.paymentChannel,
        actions: {
          desktopWebCheckoutUrl: (actions["desktop_web_checkout_url"] as string | null | undefined) ?? null,
          mobileWebCheckoutUrl: (actions["mobile_web_checkout_url"] as string | null | undefined) ?? null,
          mobileDeeplinkCheckoutUrl: (actions["mobile_deeplink_checkout_url"] as string | null | undefined) ?? null,
          qrCheckoutString: (actions["qr_checkout_string"] as string | null | undefined) ?? null,
        },
      },
    };
  }

  /** Create Closed Virtual Account (Bank Transfer). */
  @Post("xendit/virtual-accounts")
  @RequireAccess("pos", "create")
  async createVa(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateVaSchema))
    body: z.infer<typeof CreateVaSchema>,
  ) {
    const { order, va } = await this.xenditVa.createForTransaction({
      companyId,
      transactionId: body.transactionId ?? null,
      amount: body.amount,
      bankCode: body.bankCode,
      customerName: body.customerName,
      description: body.description ?? "",
    });
    return {
      data: {
        id: order.id,
        externalId: order.externalId,
        providerOrderId: order.providerOrderId,
        status: order.status,
        amount: order.amount,
        bankCode: va.bank_code,
        accountNumber: va.account_number,
        name: va.name,
        expiresAt: order.expiresAt,
      },
    };
  }

  /** Polling status VA. */
  @Get("xendit/virtual-accounts/:id")
  @RequireAccess("pos", "create")
  async findVa(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const order = await this.xenditVa.findById(id, companyId);
    const raw = (order.rawCreate as Record<string, unknown> | null) ?? {};
    return {
      data: {
        id: order.id,
        status: order.status,
        amount: order.amount,
        paidAt: order.paidAt,
        transactionId: order.transactionId,
        bankCode: order.paymentChannel,
        accountNumber: (raw["account_number"] as string | null | undefined) ?? null,
        name: (raw["name"] as string | null | undefined) ?? null,
        expiresAt: order.expiresAt,
      },
    };
  }
}
