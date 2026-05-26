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
  RegisterCompanyDto,
  RegisterCompanyResponse,
  ResendPhoneOtpResponse,
  ResetPasswordDto,
  ResetPasswordResponse,
  VerifyPhoneOtpDto,
  VerifyPhoneOtpResponse,
} from "./dto/register.dto";
import { PLATFORM_WA_SENDER_ID } from "../auth/current-company.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";
import { WhatsappReceiptService } from "../whatsapp-receipt/whatsapp-receipt.service";

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
  ) {}

  async registerCompany(
    dto: RegisterCompanyDto,
  ): Promise<RegisterCompanyResponse> {
    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);

    if (!phone) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingByEmail) {
      if (!existingByEmail.phoneVerified) {
        await this.sendNewOtp(phone);
        return { status: "needs_verification", phone };
      }
      throw new ConflictException("Email sudah terdaftar");
    }

    const existingByPhone = await this.prisma.user.findFirst({
      where: { phone },
    });
    if (existingByPhone) {
      if (!existingByPhone.phoneVerified) {
        await this.sendNewOtp(phone);
        return { status: "needs_verification", phone };
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
          phoneVerified: false,
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

    // Kirim OTP setelah company ter-create supaya user bisa lanjut verifikasi.
    await this.sendNewOtp(phone);

    return { status: "needs_verification", phone };
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

  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || !user.phone) {
      // Untuk privacy, jangan expose ke client apakah email/phone ada.
      // Tapi UI butuh phone untuk routing — kalau tidak ada, tetap throw.
      throw new NotFoundException(
        "Akun tidak ditemukan atau belum punya nomor WhatsApp",
      );
    }
    if (!user.isActive) {
      throw new BadRequestException("Akun tidak aktif");
    }
    await this.sendNewOtp(user.phone);
    return {
      phone: user.phone,
      phoneMasked: maskPhone(user.phone),
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<ResetPasswordResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const otp = dto.otp.trim().replace(/\s+/g, "");

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || !user.phone) {
      throw new NotFoundException("Akun tidak ditemukan");
    }

    const record = await this.prisma.phoneVerificationToken.findFirst({
      where: { phone: user.phone, token: { startsWith: `${otp}-` } },
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
        where: { phone: user.phone },
      }),
    ]);

    return { success: true };
  }

  async resendOtpByEmail(email: string): Promise<{ phone: string }> {
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
    await this.sendNewOtp(user.phone);
    return { phone: user.phone };
  }

  async resendPhoneOtp(phone: string): Promise<ResendPhoneOtpResponse> {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new BadRequestException("Nomor WhatsApp tidak valid");

    const user = await this.prisma.user.findFirst({
      where: { phone: normalized },
    });
    if (!user) throw new NotFoundException("Nomor WhatsApp tidak ditemukan");
    if (user.phoneVerified) {
      throw new BadRequestException("Nomor WhatsApp sudah terverifikasi");
    }

    await this.sendNewOtp(normalized);
    return { success: true };
  }

  // ===========================
  // Helpers
  // ===========================

  private async sendNewOtp(phone: string): Promise<void> {
    await this.prisma.phoneVerificationToken.deleteMany({ where: { phone } });

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const token = `${otp}-${crypto.randomBytes(3).toString("hex")}`;
    await this.prisma.phoneVerificationToken.create({
      data: {
        phone,
        token,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

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

    // Dev-fallback: log to stdout
    // eslint-disable-next-line no-console
    console.log(`\n========== WA VERIFICATION (DEV FALLBACK) ==========`);
    // eslint-disable-next-line no-console
    console.log(`To:  ${phone}`);
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
