import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Thin Xendit HTTP client. Pakai global `fetch` (Node 18+).
 * Auth: Basic dengan `secret_key:` (password kosong) base64.
 *
 * Xendit Invoices API doc: https://developers.xendit.co/api-reference/#create-invoice
 */
export type XenditCreateInvoiceInput = {
  external_id: string;
  amount: number;
  description?: string;
  invoice_duration?: number;
  customer?: {
    given_names?: string;
    email?: string;
    mobile_number?: string;
  };
  customer_notification_preference?: {
    invoice_created?: ("email" | "sms" | "whatsapp")[];
    invoice_reminder?: ("email" | "sms" | "whatsapp")[];
    invoice_paid?: ("email" | "sms" | "whatsapp")[];
  };
  success_redirect_url?: string;
  failure_redirect_url?: string;
  currency?: string;
  items?: {
    name: string;
    quantity: number;
    price: number;
    category?: string;
  }[];
  fees?: { type: string; value: number }[];
  // Limit ke method tertentu — kalau tidak set, semua method enable.
  payment_methods?: string[];
};

export type XenditInvoice = {
  id: string;
  external_id: string;
  user_id: string;
  status: "PENDING" | "PAID" | "SETTLED" | "EXPIRED" | "STOPPED";
  merchant_name: string;
  merchant_profile_picture_url?: string;
  amount: number;
  payer_email?: string;
  description?: string;
  expiry_date: string;
  invoice_url: string;
  available_banks?: unknown[];
  available_retail_outlets?: unknown[];
  available_ewallets?: unknown[];
  available_qr_codes?: unknown[];
  available_direct_debits?: unknown[];
  available_paylaters?: unknown[];
  should_exclude_credit_card?: boolean;
  should_send_email?: boolean;
  created: string;
  updated: string;
  currency: string;
  payment_method?: string;
  payment_channel?: string;
  paid_at?: string;
  paid_amount?: number;
};

export type XenditEwalletChannel =
  | "ID_OVO"
  | "ID_DANA"
  | "ID_SHOPEEPAY"
  | "ID_LINKAJA"
  | "ID_ASTRAPAY"
  | "ID_JENIUSPAY";

export type XenditEwalletCharge = {
  id: string;
  business_id: string;
  reference_id: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "VOIDED" | "REFUNDED";
  currency: string;
  charge_amount: number;
  capture_amount: number;
  channel_code: XenditEwalletChannel | string;
  channel_properties?: Record<string, unknown>;
  actions?: {
    desktop_web_checkout_url?: string | null;
    mobile_web_checkout_url?: string | null;
    mobile_deeplink_checkout_url?: string | null;
    qr_checkout_string?: string | null;
  };
  is_redirect_required: boolean;
  callback_url?: string;
  failure_code?: string | null;
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
};

export type XenditVaBank =
  | "BCA"
  | "BNI"
  | "BRI"
  | "MANDIRI"
  | "PERMATA"
  | "BJB"
  | "BSI"
  | "CIMB"
  | "SAHABAT_SAMPOERNA"
  | "BNC";

export type XenditVirtualAccount = {
  id: string;
  owner_id: string;
  external_id: string;
  bank_code: XenditVaBank | string;
  merchant_code: string;
  name: string;
  account_number: string;
  is_single_use: boolean;
  is_closed: boolean;
  expected_amount?: number;
  expiration_date?: string;
  status: "PENDING" | "ACTIVE" | "INACTIVE";
  currency: string;
};

export type XenditQrCode = {
  id: string;
  business_id: string;
  reference_id: string;
  type: "DYNAMIC" | "STATIC";
  status: "ACTIVE" | "INACTIVE";
  currency: string;
  amount?: number;
  qr_string: string;
  expires_at?: string;
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class XenditClient {
  private readonly logger = new Logger(XenditClient.name);

  constructor(private readonly config: ConfigService) {}

  private get authHeader(): string {
    const key = this.config.get<string>("XENDIT_SECRET_KEY") ?? "";
    return "Basic " + Buffer.from(`${key}:`).toString("base64");
  }

  private get base(): string {
    return this.config.get<string>("XENDIT_API_BASE") ?? "https://api.xendit.co";
  }

  async createInvoice(input: XenditCreateInvoiceInput): Promise<XenditInvoice> {
    const url = `${this.base}/v2/invoices`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      this.logger.warn(`Xendit createInvoice failed: ${msg}`);
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditInvoice;
  }

  async getInvoice(invoiceId: string): Promise<XenditInvoice> {
    const url = `${this.base}/v2/invoices/${invoiceId}`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditInvoice;
  }

  /**
   * Create Closed Virtual Account (Bank Transfer).
   * Doc: https://developers.xendit.co/api-reference/#create-virtual-account
   */
  async createVirtualAccount(input: {
    external_id: string;
    bank_code: XenditVaBank | string;
    name: string;
    expected_amount: number;
    is_closed?: boolean;
    is_single_use?: boolean;
    expiration_date?: string;
  }): Promise<XenditVirtualAccount> {
    const url = `${this.base}/callback_virtual_accounts`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify({
        external_id: input.external_id,
        bank_code: input.bank_code,
        name: input.name,
        is_closed: input.is_closed ?? true,
        is_single_use: input.is_single_use ?? true,
        expected_amount: input.expected_amount,
        ...(input.expiration_date ? { expiration_date: input.expiration_date } : {}),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      this.logger.warn(`Xendit createVirtualAccount failed: ${msg}`);
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditVirtualAccount;
  }

  async getVirtualAccount(vaId: string): Promise<XenditVirtualAccount> {
    const url = `${this.base}/callback_virtual_accounts/${vaId}`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditVirtualAccount;
  }

  /**
   * Create E-Wallet Charge (Direct API).
   * Doc: https://developers.xendit.co/api-reference/#create-e-wallet-charge
   */
  async createEwalletCharge(input: {
    reference_id: string;
    amount: number;
    currency?: string;
    channel_code: XenditEwalletChannel | string;
    mobile_number?: string; // diperlukan untuk OVO/JENIUS, dll.
    success_redirect_url?: string;
    failure_redirect_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<XenditEwalletCharge> {
    const url = `${this.base}/ewallets/charges`;
    const channelProperties: Record<string, unknown> = {};
    if (input.mobile_number) channelProperties.mobile_number = input.mobile_number;
    if (input.success_redirect_url) channelProperties.success_redirect_url = input.success_redirect_url;
    if (input.failure_redirect_url) channelProperties.failure_redirect_url = input.failure_redirect_url;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify({
        reference_id: input.reference_id,
        currency: input.currency ?? "IDR",
        amount: input.amount,
        checkout_method: "ONE_TIME_PAYMENT",
        channel_code: input.channel_code,
        channel_properties: channelProperties,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      this.logger.warn(`Xendit createEwalletCharge failed: ${msg}`);
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditEwalletCharge;
  }

  async getEwalletCharge(chargeId: string): Promise<XenditEwalletCharge> {
    const url = `${this.base}/ewallets/charges/${chargeId}`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditEwalletCharge;
  }

  /**
   * Create QR Code (Dynamic QRIS) via Xendit Direct QR API.
   * Doc: https://developers.xendit.co/api-reference/#create-qr-code
   * api-version: 2022-07-31
   */
  async createQrCode(input: {
    reference_id: string;
    amount: number;
    currency?: string;
    expires_at?: string;
    metadata?: Record<string, unknown>;
  }): Promise<XenditQrCode> {
    const url = `${this.base}/qr_codes`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-version": "2022-07-31",
        Authorization: this.authHeader,
      },
      body: JSON.stringify({
        reference_id: input.reference_id,
        type: "DYNAMIC",
        currency: input.currency ?? "IDR",
        amount: input.amount,
        ...(input.expires_at ? { expires_at: input.expires_at } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      this.logger.warn(`Xendit createQrCode failed: ${msg}`);
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditQrCode;
  }

  async getQrCode(qrId: string): Promise<XenditQrCode> {
    const url = `${this.base}/qr_codes/${qrId}`;
    const res = await fetch(url, {
      headers: {
        "api-version": "2022-07-31",
        Authorization: this.authHeader,
      },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditQrCode;
  }

  async expireInvoice(invoiceId: string): Promise<XenditInvoice> {
    const url = `${this.base}/invoices/${invoiceId}/expire!`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: this.authHeader },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error_code)) || `HTTP ${res.status}`;
      throw new Error(`Xendit error: ${msg}`);
    }
    return json as XenditInvoice;
  }
}
