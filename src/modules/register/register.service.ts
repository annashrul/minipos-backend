import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type {
  RegisterCompanyDto,
  RegisterCompanyResponse,
  ResendVerificationEmailResponse,
  VerifyEmailOtpDto,
  VerifyEmailOtpResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";

/**
 * Company self-registration.
 *
 * NOTE on email delivery:
 *   The original web server-action used `Resend` (via @/lib/email).
 *   The API does not yet have a Resend (or generic mail) dependency, so this
 *   service falls back to logging the OTP to stdout â€” exactly the same
 *   dev-fallback the web action used when RESEND_API_KEY was missing.
 *   Wire a real mail provider here once the API gets one.
 */
@Injectable()
export class RegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async registerCompany(
    dto: RegisterCompanyDto,
  ): Promise<RegisterCompanyResponse> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      if (!existingUser.emailVerified) {
        await this.sendNewVerificationToken(email);
        return { status: "needs_verification", email };
      }
      throw new ConflictException("Email sudah terdaftar");
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
          password: hashedPassword,
          role: "SUPER_ADMIN",
          companyId: company.id,
          branchId: branch.id,
          emailVerified: true,
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

      const withCompanyCode = (baseCode: string) =>
        `${baseCode}-${company.id.slice(0, 4).toUpperCase()}`;

      await tx.account.createMany({
        data: [
          { code: withCompanyCode("1-1001"), name: "Kas", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("1-1002"), name: "Bank", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("1-1003"), name: "Piutang Dagang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("1-1004"), name: "Persediaan Barang", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("1-1005"), name: "Perlengkapan Toko", categoryId: acAsset.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("1-2001"), name: "Peralatan Toko", categoryId: acAsset.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("2-1001"), name: "Hutang Dagang", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("2-1002"), name: "Hutang Pajak", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("2-1003"), name: "Hutang Gaji", categoryId: acLiability.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("3-1001"), name: "Modal Pemilik", categoryId: acEquity.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("3-1002"), name: "Laba Ditahan", categoryId: acEquity.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("4-1001"), name: "Pendapatan Penjualan", categoryId: acRevenue.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("4-1002"), name: "Retur Penjualan", categoryId: acRevenue.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("4-2001"), name: "Pendapatan Lain-lain", categoryId: acRevenue.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("5-1001"), name: "Harga Pokok Penjualan", categoryId: acExpense.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("5-1002"), name: "Beban Operasional", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("5-1003"), name: "Beban Gaji", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("5-1004"), name: "Beban Listrik & Air", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("5-1005"), name: "Beban Sewa", categoryId: acExpense.id, isActive: true, isSystem: false, openingBalance: 0 },
          { code: withCompanyCode("5-1010"), name: "Beban PPh 23", categoryId: acExpense.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("2-1100"), name: "PPN Keluaran", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("1-1100"), name: "PPN Masukan", categoryId: acAsset.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("2-1200"), name: "Hutang PPh 21", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
          { code: withCompanyCode("2-1201"), name: "Hutang PPh 23", categoryId: acLiability.id, isActive: true, isSystem: true, openingBalance: 0 },
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

    return { status: "created" };
  }

  async verifyEmailOtp(
    dto: VerifyEmailOtpDto,
  ): Promise<VerifyEmailOtpResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedOtp = dto.otp.trim().replace(/\s+/g, "");

    if (!normalizedEmail || !normalizedOtp) {
      throw new BadRequestException("Email dan OTP wajib diisi");
    }

    const record = await this.prisma.emailVerificationToken.findFirst({
      where: {
        email: normalizedEmail,
        token: { startsWith: `${normalizedOtp}-` },
      },
    });

    if (!record) {
      throw new BadRequestException("Kode OTP tidak valid");
    }

    if (record.expiresAt < new Date()) {
      await this.prisma.emailVerificationToken.delete({
        where: { id: record.id },
      });
      throw new BadRequestException(
        "Kode OTP sudah kedaluwarsa. Silakan kirim ulang.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan");

    if (!user.emailVerified) {
      await this.prisma.user.update({
        where: { email: normalizedEmail },
        data: { emailVerified: true },
      });
    }

    await this.prisma.emailVerificationToken.deleteMany({
      where: { email: normalizedEmail },
    });

    const loginToken = `login_${crypto.randomBytes(24).toString("hex")}`;
    await this.prisma.emailVerificationToken.create({
      data: {
        email: normalizedEmail,
        token: loginToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return { loginToken };
  }

  async resendVerificationEmail(
    email: string,
  ): Promise<ResendVerificationEmailResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user) throw new NotFoundException("Email tidak ditemukan");
    if (user.emailVerified) {
      throw new BadRequestException("Email sudah terverifikasi");
    }

    await this.sendNewVerificationToken(normalizedEmail);
    return { success: true };
  }

  // ===========================
  // Helpers
  // ===========================

  private async sendNewVerificationToken(email: string): Promise<void> {
    await this.prisma.emailVerificationToken.deleteMany({ where: { email } });

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const token = `${otp}-${crypto.randomBytes(3).toString("hex")}`;
    await this.prisma.emailVerificationToken.create({
      data: {
        email,
        token,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // TODO: wire a real mail provider (Resend / Nodemailer / SES) here.
    // For now we mirror the dev-fallback used by the web `email.ts`.
    // eslint-disable-next-line no-console
    console.log(`\n========== EMAIL VERIFICATION ==========`);
    // eslint-disable-next-line no-console
    console.log(`To:  ${email}`);
    // eslint-disable-next-line no-console
    console.log(`OTP: ${otp}`);
    // eslint-disable-next-line no-console
    console.log(`=========================================\n`);
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
