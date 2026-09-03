import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type {
  ForgotPasswordResponse,
  OtpChannel,
  RegisterCompanyDto,
  RegisterCompanyResponse,
  ResendPhoneOtpResponse,
  ResetPasswordDto,
  ResetPasswordResponse,
  VerifyPhoneOtpDto,
  VerifyPhoneOtpResponse,
} from "./dto/register.dto";
import { PLATFORM_WA_SENDER_ID } from "@/modules/auth/current-company.decorator";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import { WhatsappReceiptService } from "@/modules/whatsapp-receipt/whatsapp-receipt.service";
import { EmailService } from "@/modules/email/email.service";

/**
 * Company self-registration dengan verifikasi OTP via WhatsApp.
 *
 * OTP delivery:
 *   Sender = baris di tabel `whatsapp_sessions` dengan companyId =
 *   PLATFORM_WA_SENDER_ID (di-hardcode di service). Baris itu harus
 *   berstatus CONNECTED supaya OTP terkirim. Kalau session tidak ada /
 *   tidak CONNECTED, fall-back ke console log (dev) atau throw (prod).
 */
@Injectable()
export class RegisterService {
  private readonly logger = new Logger(RegisterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly waReceipt: WhatsappReceiptService,
    private readonly email: EmailService,
  ) {}

  async registerCompany(
    dto: RegisterCompanyDto,
    opts?: { autoActivate?: boolean },
  ): Promise<RegisterCompanyResponse> {
    // autoActivate = tenant dibuat oleh PLATFORM OWNER (jalur internal, bukan
    // self-register publik). User admin langsung phoneVerified=true & TIDAK
    // kirim OTP — tenant aktif & bisa login segera.
    const autoActivate = opts?.autoActivate === true;
    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);
    const channel: OtpChannel = dto.channel ?? "wa";

    if (!phone) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingByEmail) {
      // Jalur publik: user belum verified → kirim ulang OTP. Jalur platform
      // (autoActivate) selalu tolak duplikat — admin buat tenant baru.
      if (!existingByEmail.phoneVerified && !autoActivate) {
        await this.sendNewOtp({ channel, email, phone });
        return needsVerification(phone, channel, email);
      }
      throw new ConflictException("Email sudah terdaftar");
    }

    const existingByPhone = await this.prisma.user.findFirst({
      where: { phone },
    });
    if (existingByPhone) {
      if (!existingByPhone.phoneVerified && !autoActivate) {
        await this.sendNewOtp({ channel, email, phone });
        return needsVerification(phone, channel, email);
      }
      throw new ConflictException("Nomor WhatsApp sudah terdaftar");
    }

    let slug = generateSlug(dto.companyName);
    const existingSlug = await this.prisma.company.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let createdCompanyId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.companyName,
          slug,
          phone: dto.companyPhone ?? null,
          address: dto.companyAddress ?? null,
          email,
          businessUnit: dto.businessUnit ?? "RETAIL",
        },
      });

      const branch = await tx.branch.create({
        data: {
          name: "Cabang Utama",
          code: "HQ",
          companyId: company.id,
        },
      });

      await tx.user.create({
        data: {
          name: dto.name,
          email,
          phone,
          password: hashedPassword,
          role: "SUPER_ADMIN",
          companyId: company.id,
          branchId: branch.id,
          emailVerified: true,
          phoneVerified: autoActivate,
        },
      });

      await tx.category.createMany({
        data: [
          { name: "Makanan", description: "Menu makanan", companyId: company.id },
          { name: "Minuman", description: "Menu minuman", companyId: company.id },
          { name: "Snack", description: "Makanan ringan dan cemilan", companyId: company.id },
          { name: "Dessert", description: "Menu penutup dan kue", companyId: company.id },
          { name: "Lainnya", description: "Produk lainnya", companyId: company.id },
        ],
      });

      await tx.brand.createMany({
        data: [
          { name: "Tanpa Brand", companyId: company.id },
          { name: "House Brand", companyId: company.id },
        ],
      });

      await tx.supplier.create({
        data: { name: "Supplier Umum", companyId: company.id },
      });

      const acAsset = await tx.accountCategory.create({ data: { name: "Aset", type: "ASSET", normalSide: "DEBIT", sortOrder: 1, companyId: company.id } });
      const acLiability = await tx.accountCategory.create({ data: { name: "Kewajiban", type: "LIABILITY", normalSide: "CREDIT", sortOrder: 2, companyId: company.id } });
      const acEquity = await tx.accountCategory.create({ data: { name: "Modal", type: "EQUITY", normalSide: "CREDIT", sortOrder: 3, companyId: company.id } });
      const acRevenue = await tx.accountCategory.create({ data: { name: "Pendapatan", type: "REVENUE", normalSide: "CREDIT", sortOrder: 4, companyId: company.id } });
      const acExpense = await tx.accountCategory.create({ data: { name: "Beban", type: "EXPENSE", normalSide: "DEBIT", sortOrder: 5, companyId: company.id } });

      // Pakai kode polos (tanpa suffix companyId) supaya match dengan
      // pola lookup di AutoJournalService.getSystemAccounts(["1-1001",...])
      // yang nyari berdasarkan kode + categoryId.companyId. Account.code
      // tidak punya unique constraint global → suffix tidak diperlukan.
      await tx.account.createMany({
        data: [
          { code: "1-1001", name: "Kas", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1002", name: "Bank", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1003", name: "Piutang Dagang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1004", name: "Persediaan Barang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1005", name: "Perlengkapan Toko", categoryId: acAsset.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "1-2001", name: "Peralatan Toko", categoryId: acAsset.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "2-1001", name: "Hutang Dagang", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1002", name: "Hutang Pajak", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1003", name: "Hutang Gaji", categoryId: acLiability.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "3-1001", name: "Modal Pemilik", categoryId: acEquity.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "3-1002", name: "Laba Ditahan", categoryId: acEquity.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "4-1001", name: "Pendapatan Penjualan", categoryId: acRevenue.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "4-1002", name: "Retur Penjualan", categoryId: acRevenue.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "4-2001", name: "Pendapatan Lain-lain", categoryId: acRevenue.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "5-1001", name: "Harga Pokok Penjualan", categoryId: acExpense.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "5-1002", name: "Beban Operasional", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "5-1003", name: "Beban Gaji", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "5-1004", name: "Beban Listrik & Air", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "5-1005", name: "Beban Sewa", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: "5-1010", name: "Beban PPh 23", categoryId: acExpense.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1100", name: "PPN Keluaran", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1100", name: "PPN Masukan", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1200", name: "Hutang PPh 21", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1201", name: "Hutang PPh 23", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
        ],
      });

      await tx.restaurantTable.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          number: i + 1,
          name: `Meja ${i + 1}`,
          capacity: 4,
          branchId: branch.id,
          section: i < 6 ? "Indoor" : "Outdoor",
          sortOrder: i + 1,
        })),
      });

      createdCompanyId = company.id;
    });

    if (createdCompanyId) {
      this.realtime.emit(EVENTS.COMPANY_REGISTERED, {
        companyId: createdCompanyId,
        slug,
      });
    }

    // Jalur platform: tenant langsung aktif, tanpa OTP.
    if (autoActivate) {
      return { status: "created" };
    }

    // Jalur publik: kirim OTP supaya user lanjut verifikasi.
    await this.sendNewOtp({ channel, email, phone });

    return needsVerification(phone, channel, email);
  }

  async verifyPhoneOtp(
    dto: VerifyPhoneOtpDto,
  ): Promise<VerifyPhoneOtpResponse> {
    const phone = normalizePhone(dto.phone);
    const normalizedOtp = dto.otp.trim().replace(/\s+/g, "");

    if (!phone || !normalizedOtp) {
      throw new BadRequestException("Nomor WhatsApp dan OTP wajib diisi");
    }

    const record = await this.prisma.phoneVerificationToken.findFirst({
      where: {
        phone,
        token: { startsWith: `${normalizedOtp}-` },
      },
    });

    if (!record) {
      throw new BadRequestException("Kode OTP tidak valid");
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.phoneVerificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(
        "Kode OTP sudah kedaluwarsa. Silakan kirim ulang.",
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { phone },
      select: { id: true, email: true, phoneVerified: true },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan");

    if (!user.phoneVerified) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true, emailVerified: true },
      });
    }

    await this.prisma.phoneVerificationToken.deleteMany({
      where: { phone },
    });

    // Issue short-lived auto-login token via existing email-token store
    // (one-time use, 5 menit). Auth shim sudah mendukung token ini.
    const loginToken = `login_${crypto.randomBytes(24).toString("hex")}`;
    await this.prisma.emailVerificationToken.create({
      data: {
        email: user.email,
        token: loginToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return { loginToken };
  }

  async checkAvailability(
    email?: string,
    phone?: string,
  ): Promise<{ email: boolean; phone: boolean }> {
    const result = { email: true, phone: true };
    if (email?.trim()) {
      const e = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
      result.email = !e;
    }
    if (phone?.trim()) {
      const p = normalizePhone(phone);
      if (p) {
        const u = await this.prisma.user.findFirst({ where: { phone: p }, select: { id: true } });
        result.phone = !u;
      }
    }
    return result;
  }

  // ── New flow: request OTP → verify → create ───────────────────────

  async requestRegisterOtp(
    dto: RegisterCompanyDto,
  ): Promise<{ phone: string; phoneMasked: string; channel: OtpChannel; destinationMasked: string }> {
    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);
    const channel: OtpChannel = dto.channel ?? "wa";

    if (!phone) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      if (!existingByEmail.phoneVerified) {
        // Re-send OTP untuk user belum verifikasi
        await this.sendNewOtp({ channel, email, phone });
        return { phone, phoneMasked: maskPhone(phone), channel, destinationMasked: channel === "email" ? maskEmail(email) : maskPhone(phone) };
      }
      throw new ConflictException("Email sudah terdaftar");
    }

    const existingByPhone = await this.prisma.user.findFirst({ where: { phone } });
    if (existingByPhone) {
      if (!existingByPhone.phoneVerified) {
        await this.sendNewOtp({ channel, email, phone });
        return { phone, phoneMasked: maskPhone(phone), channel, destinationMasked: channel === "email" ? maskEmail(email) : maskPhone(phone) };
      }
      throw new ConflictException("Nomor WhatsApp sudah terdaftar");
    }

    // Store pending data encoded in token
    const payload = {
      companyName: dto.companyName,
      companyPhone: dto.companyPhone,
      companyAddress: dto.companyAddress,
      businessUnit: dto.businessUnit,
      name: dto.name,
      email,
      password: dto.password,
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

    const pendingTokenKey = `pending:${payloadBase64}`;
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const token = `${otp}-${crypto.randomBytes(3).toString("hex")}--${pendingTokenKey}`;

    this.logger.log(`[OTP] ${otp} → ${phone} (${channel})`);

    await this.prisma.phoneVerificationToken.deleteMany({ where: { phone } });
    await this.prisma.phoneVerificationToken.create({
      data: {
        phone,
        token,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    if (channel === "email") {
      await this.sendOtpViaEmail(otp, email);
    } else {
      await this.sendOtpViaWhatsapp(otp, phone);
    }

    return {
      phone,
      phoneMasked: maskPhone(phone),
      channel,
      destinationMasked: channel === "email" ? maskEmail(email) : maskPhone(phone),
    };
  }

  async verifyAndCreate(
    dto: { phone: string; otp: string },
  ): Promise<{ loginToken: string }> {
    const phone = normalizePhone(dto.phone);
    const otp = dto.otp.trim().replace(/\s+/g, "");

    if (!phone) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const record = await this.prisma.phoneVerificationToken.findFirst({
      where: { phone, token: { startsWith: `${otp}-` } },
    });
    if (!record) throw new BadRequestException("Kode OTP tidak valid");
    if (record.expiresAt < new Date()) {
      await this.prisma.phoneVerificationToken.delete({ where: { id: record.id } });
      throw new BadRequestException("Kode OTP sudah kedaluwarsa");
    }

    // Extract pending payload from token: {otp}-{hex}--pending:{base64json}
    const payloadMatch = record.token.match(/--pending:(.+)$/);
    let payload: {
      companyName: string;
      companyPhone?: string;
      companyAddress?: string;
      businessUnit?: string;
      name: string;
      email: string;
      password: string;
    };
    try {
      payload = JSON.parse(
        Buffer.from(payloadMatch?.[1] ?? "", "base64url").toString("utf8"),
      );
    } catch {
      throw new BadRequestException("Data pendaftaran tidak valid. Silakan daftar ulang.");
    }
    if (!payload?.email || !payload?.name || !payload?.password || !payload?.companyName) {
      throw new BadRequestException("Data pendaftaran tidak lengkap. Silakan daftar ulang.");
    }

    // Delete token & create everything
    await this.prisma.phoneVerificationToken.delete({ where: { id: record.id } });

    let slug = generateSlug(payload.companyName);
    const existingSlug = await this.prisma.company.findUnique({ where: { slug } });
    if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`;

    const hashedPassword = await bcrypt.hash(payload.password, 10);
    const email = payload.email;

    await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: payload.companyName,
          slug,
          phone: payload.companyPhone ?? null,
          address: payload.companyAddress ?? null,
          email,
          businessUnit: (payload.businessUnit as string) ?? "RETAIL",
        },
      });

      const branch = await tx.branch.create({
        data: { name: "Cabang Utama", code: "HQ", companyId: company.id },
      });

      await tx.user.create({
        data: {
          name: payload.name,
          email,
          phone,
          password: hashedPassword,
          role: "SUPER_ADMIN",
          companyId: company.id,
          branchId: branch.id,
          emailVerified: true,
          phoneVerified: true,
        },
      });

      await tx.category.createMany({
        data: [
          { name: "Makanan", description: "Menu makanan", companyId: company.id },
          { name: "Minuman", description: "Menu minuman", companyId: company.id },
          { name: "Snack", description: "Makanan ringan dan cemilan", companyId: company.id },
          { name: "Dessert", description: "Menu penutup dan kue", companyId: company.id },
          { name: "Lainnya", description: "Produk lainnya", companyId: company.id },
        ],
      });

      await tx.brand.createMany({
        data: [
          { name: "Tanpa Brand", companyId: company.id },
          { name: "House Brand", companyId: company.id },
        ],
      });

      await tx.supplier.create({
        data: { name: "Supplier Umum", companyId: company.id },
      });

      const acAsset = await tx.accountCategory.create({ data: { name: "Aset", type: "ASSET", normalSide: "DEBIT", sortOrder: 1, companyId: company.id } });
      const acLiability = await tx.accountCategory.create({ data: { name: "Kewajiban", type: "LIABILITY", normalSide: "CREDIT", sortOrder: 2, companyId: company.id } });
      const acEquity = await tx.accountCategory.create({ data: { name: "Modal", type: "EQUITY", normalSide: "CREDIT", sortOrder: 3, companyId: company.id } });
      const acRevenue = await tx.accountCategory.create({ data: { name: "Pendapatan", type: "REVENUE", normalSide: "CREDIT", sortOrder: 4, companyId: company.id } });
      const acExpense = await tx.accountCategory.create({ data: { name: "Beban", type: "EXPENSE", normalSide: "DEBIT", sortOrder: 5, companyId: company.id } });

      await tx.account.createMany({
        data: [
          { code: "1-1001", name: "Kas", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1002", name: "Bank", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1003", name: "Piutang Dagang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "1-1004", name: "Persediaan Barang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: "2-1001", name: "Hutang Dagang", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
        ],
      });
    });

    // Auto-login token
    const user = await this.prisma.user.findUnique({ where: { email } });
    const loginToken = `login_${crypto.randomBytes(24).toString("hex")}`;
    await this.prisma.emailVerificationToken.create({
      data: {
        email: user?.email ?? email,
        token: loginToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return { loginToken };
  }

  async forgotPassword(
    email?: string,
    phone?: string,
    channel: OtpChannel = "wa",
  ): Promise<ForgotPasswordResponse> {
    const normalizedEmail = (email ?? "").trim().toLowerCase();
    const normalizedPhone = normalizePhone(phone);

    let user: { id: string; email: string; phone: string | null; isActive: boolean } | null = null;
    if (normalizedEmail) {
      user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    } else if (normalizedPhone) {
      user = await this.prisma.user.findFirst({ where: { phone: normalizedPhone } });
    }

    if (!user) {
      throw new NotFoundException("Akun tidak ditemukan");
    }
    if (channel === "wa" && !user.phone) {
      throw new NotFoundException(
        "Akun belum punya nomor WhatsApp. Gunakan kirim via Email.",
      );
    }
    if (!user.isActive) {
      throw new BadRequestException("Akun tidak aktif");
    }
    await this.sendNewOtp({
      channel,
      email: user.email,
      phone: user.phone,
    });
    return {
      email: user.email,
      phone: user.phone ?? "",
      phoneMasked: user.phone ? maskPhone(user.phone) : "",
      channel,
      destinationMasked:
        channel === "email" ? maskEmail(user.email) : maskPhone(user.phone ?? ""),
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<ResetPasswordResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const otp = dto.otp.trim().replace(/\s+/g, "");

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) {
      throw new NotFoundException("Akun tidak ditemukan");
    }

    // Email channel: OTP disimpan dengan key = email. WA channel: key = phone.
    // Coba lookup by email dulu, fallback ke phone.
    const tokenWhere = [
      { phone: normalizedEmail, token: { startsWith: `${otp}-` } },
      ...(user.phone ? [{ phone: user.phone, token: { startsWith: `${otp}-` } }] : []),
    ];
    const record = await this.prisma.phoneVerificationToken.findFirst({
      where: { OR: tokenWhere },
    });
    if (!record) throw new BadRequestException("Kode OTP tidak valid");
    if (record.expiresAt < new Date()) {
      await this.prisma.phoneVerificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException("Kode OTP sudah kedaluwarsa");
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, phoneVerified: true },
      }),
      this.prisma.phoneVerificationToken.deleteMany({
        where: { phone: { in: [normalizedEmail].concat(user.phone ? [user.phone] : []) } },
      }),
    ]);

    return { success: true };
  }

  async resendOtpByEmail(
    email: string,
    channel: OtpChannel = "wa",
  ): Promise<{ phone: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) throw new NotFoundException("Email tidak ditemukan");
    if (!user.phone) {
      throw new BadRequestException("User belum punya nomor WhatsApp terdaftar");
    }
    if (user.phoneVerified) {
      throw new BadRequestException("Akun sudah terverifikasi");
    }
    await this.sendNewOtp({ channel, email: normalizedEmail, phone: user.phone });
    return { phone: user.phone };
  }

  async resendPhoneOtp(
    phone: string,
    channel: OtpChannel = "wa",
  ): Promise<ResendPhoneOtpResponse> {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const user = await this.prisma.user.findFirst({
      where: { phone: normalized },
      select: { email: true, phoneVerified: true },
    });
    if (!user) throw new NotFoundException("Nomor WhatsApp tidak ditemukan");
    if (user.phoneVerified) {
      throw new BadRequestException("Nomor WhatsApp sudah terverifikasi");
    }

    await this.sendNewOtp({ channel, email: user.email, phone: normalized });
    return { success: true };
  }

  // ===========================
  // Helpers
  // ===========================

  /**
  /**
   * Generate + simpan OTP lalu KIRIM lewat channel yang dipilih.
   * - channel "wa"    → key = phone, kirim via WhatsApp sender.
   * - channel "email" → key = email, kirim via EmailService.
   */
  private async sendNewOtp(opts: {
    channel: OtpChannel;
    email: string;
    phone?: string | null;
  }): Promise<void> {
    const channel = opts.channel;
    const tokenKey = channel === "email" ? opts.email : (opts.phone ?? opts.email);

    // Preserve registration payload if exists in old token
    const old = await this.prisma.phoneVerificationToken.findFirst({ where: { phone: tokenKey } });
    const pendingSuffix = old?.token.match(/--pending:(.+)$/)?.[1] ?? null;

    await this.prisma.phoneVerificationToken.deleteMany({ where: { phone: tokenKey } });

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    let token = `${otp}-${crypto.randomBytes(3).toString("hex")}`;
    if (pendingSuffix) token += `--pending:${pendingSuffix}`;

    this.logger.log(`[OTP] ${otp} → ${opts.channel === "email" ? opts.email : (opts.phone ?? opts.email)} (${opts.channel})`);

    await this.prisma.phoneVerificationToken.create({
      data: { phone: tokenKey, token, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    });

    if (channel === "email") { await this.sendOtpViaEmail(otp, opts.email); return; }
    await this.sendOtpViaWhatsapp(otp, tokenKey);
  }

  private async sendOtpViaEmail(
    otp: string,
    email: string | null,
  ): Promise<void> {
    if (!email) {
      throw new BadRequestException("Email tujuan OTP tidak tersedia");
    }
    if (!this.email.isConfigured()) {
      this.logger.warn("Email OTP diminta tapi EmailService belum dikonfigurasi");
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "Pengiriman OTP via email belum dikonfigurasi. Coba pakai WhatsApp.",
        );
      }
      this.devLogOtp(email, otp);
      return;
    }
    try {
      await this.email.send({
        to: email,
        subject: "Kode Verifikasi MenoPOS",
        html: buildOtpEmailHtml(otp),
      });
      this.logger.log(`OTP sent via email to ${maskEmail(email)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email OTP send failed for ${maskEmail(email)}: ${msg}`);
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "Gagal mengirim OTP via email. Silakan coba lagi atau pakai WhatsApp.",
        );
      }
      this.devLogOtp(email, otp);
    }
  }

  private async sendOtpViaWhatsapp(otp: string, phone: string): Promise<void> {
    const message =
      `*Kode Verifikasi MenoPOS*\n\n` +
      `OTP: *${otp}*\n` +
      `Berlaku 15 menit. Jangan bagikan kode ini ke siapa pun.`;

    // Lookup platform sender dari tabel whatsapp_sessions. Pengirim valid
    // hanya kalau status = CONNECTED (sesi Baileys aktif & punya creds).
    const senderSession = await this.prisma.whatsappSession.findFirst({
      where: { companyId: PLATFORM_WA_SENDER_ID },
      select: { companyId: true, status: true, phoneNumber: true },
    });

    if (senderSession && senderSession.status === "CONNECTED") {
      try {
        await this.waReceipt.sendText(senderSession.companyId, phone, message);
        this.logger.log(
          `OTP sent via WA to ${maskPhone(phone)} (sender=${
            senderSession.phoneNumber ?? senderSession.companyId
          })`,
        );
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `WA OTP send failed for ${maskPhone(phone)}: ${msg}`,
        );
        if (process.env.NODE_ENV === "production") {
          throw new ServiceUnavailableException(
            "Gagal mengirim OTP via WhatsApp. Silakan coba lagi atau hubungi admin.",
          );
        }
      }
    } else {
      this.logger.warn(
        `Platform WA sender (companyId=${PLATFORM_WA_SENDER_ID}) status=${
          senderSession?.status ?? "NOT_FOUND"
        } — fallback ke console log (dev only)`,
      );
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "OTP service belum siap — sesi WhatsApp pengirim tidak aktif.",
        );
      }
    }

    this.devLogOtp(phone, otp);
  }

  private devLogOtp(destination: string, otp: string): void {
    // eslint-disable-next-line no-console
    console.log(`\n========== OTP VERIFICATION (DEV FALLBACK) ==========`);
    // eslint-disable-next-line no-console
    console.log(`To:  ${destination}`);
    // eslint-disable-next-line no-console
    console.log(`OTP: ${otp}`);
    // eslint-disable-next-line no-console
    console.log(`====================================================\n`);
  }
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Normalisasi ke format internasional `+62...` (Indonesia default).
 * Terima `08...`, `628...`, `+628...`. Drop spasi/dash/dll.
 */
function normalizePhone(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("62")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+62${cleaned.slice(1)}`;
  return `+62${cleaned}`;
}

function maskPhone(phone: string): string {
  return phone.length > 6
    ? `${phone.slice(0, 4)}***${phone.slice(-3)}`
    : phone;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/** Bentuk respons "needs_verification" dengan tujuan tersamarkan per channel. */
function needsVerification(
  phone: string,
  channel: OtpChannel,
  email: string,
): RegisterCompanyResponse {
  return {
    status: "needs_verification",
    phone,
    channel,
    destinationMasked: channel === "email" ? maskEmail(email) : maskPhone(phone),
  };
}

/** Email HTML untuk kode OTP — monokrom, ramah email client. */
function buildOtpEmailHtml(otp: string): string {
  return (
    `<div style="background:#f4f4f5;padding:24px 0;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif">` +
    `<div style="max-width:380px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">` +
    `<h1 style="margin:0 0 8px;font-size:18px;color:#1a1a1a">Kode Verifikasi MenoPOS</h1>` +
    `<p style="margin:0 0 18px;font-size:13px;color:#666">Gunakan kode berikut untuk melanjutkan. Berlaku 15 menit.</p>` +
    `<div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1a1a1a;text-align:center;background:#f4f4f5;border-radius:10px;padding:16px 0">${otp}</div>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#999">Jangan bagikan kode ini ke siapa pun. Jika Anda tidak meminta kode ini, abaikan email ini.</p>` +
    `</div></div>`
  );
}
