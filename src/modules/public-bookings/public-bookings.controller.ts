import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { BookingsService } from "../bookings/bookings.service";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";
import { RedisService } from "../redis/redis.service";
import { WhatsappReceiptService } from "../whatsapp-receipt/whatsapp-receipt.service";

/**
 * Schema input dari halaman public `/book/[slug]`. Customer-facing — hanya
 * field yang relevan & yang boleh customer isi sendiri:
 *  - branchId (dipilih dari list active branches company).
 *  - scheduledAt (tanggal+waktu).
 *  - customerName + customerPhone (walk-in identitas).
 *  - vehiclePlate, vehicleBrand, vehicleModel, serviceType, complaint.
 *
 * vehicleId / customerId tidak diisi (customer tidak punya akses ke master
 * data) — staff akan link manual saat konfirmasi booking.
 */
export const PublicCreateBookingSchema = z.object({
  branchId: z.string().min(1, "Branch wajib dipilih"),
  scheduledAt: z.string().datetime({ offset: true }),
  customerName: z.string().trim().min(1, "Nama wajib diisi"),
  customerPhone: z
    .string()
    .trim()
    .min(8, "Nomor HP minimal 8 digit")
    .max(20, "Nomor HP maksimal 20 digit"),
  vehicleType: z.enum(["MOBIL", "MOTOR"], { message: "Pilih tipe kendaraan" }),
  vehiclePlate: z.string().trim().min(1, "Plat kendaraan wajib diisi"),
  vehicleBrand: z.string().trim().nullable().optional(),
  vehicleModel: z.string().trim().nullable().optional(),
  serviceType: z.string().trim().min(1, "Jenis service wajib diisi"),
  complaint: z.string().trim().nullable().optional(),
  // Token bukti nomor sudah verified via OTP. Diperoleh dari endpoint
  // /otp/verify dan TTL 30 menit. OPSIONAL: kalau customer existing
  // (existingCustomerId di-set), backend akan trust phone match → skip OTP.
  verifiedToken: z.string().optional(),
  // Kalau customer sudah terdaftar (lookup endpoint return found), pass
  // customerId sini supaya backend skip OTP (trusted: phone match record).
  existingCustomerId: z.string().optional(),
});

export type PublicCreateBookingDto = z.infer<typeof PublicCreateBookingSchema>;

export const PublicOtpRequestSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8, "Nomor HP minimal 8 digit")
    .max(20, "Nomor HP maksimal 20 digit"),
});

// Lookup customer by phone — supaya FE bisa skip OTP kalau customer existing.
export const PublicLookupSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8, "Nomor HP minimal 8 digit")
    .max(20, "Nomor HP maksimal 20 digit"),
});

export const PublicOtpVerifySchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8, "Nomor HP minimal 8 digit")
    .max(20, "Nomor HP maksimal 20 digit"),
  code: z.string().trim().regex(/^\d{6}$/, "Kode OTP 6 digit"),
});

/** Normalisasi nomor untuk konsistensi key Redis & WA dispatch. */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("0")) cleaned = "62" + cleaned.slice(1);
  return cleaned;
}

const OTP_TTL_SEC = 5 * 60; // 5 menit
const OTP_RATE_LIMIT_SEC = 30; // bisa request OTP lagi setelah 30 detik
const VERIFIED_TOKEN_TTL_SEC = 30 * 60; // token sah 30 menit

@Controller("public/bookings")
export class PublicBookingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingsService: BookingsService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly waReceipt: WhatsappReceiptService,
  ) {}

  /** GET /public/bookings/:slug/info — info company + cabang aktif. */
  @Public()
  @Get(":slug/info")
  async info(@Param("slug") slug: string) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        businessUnit: true,
      },
    });
    if (!company) throw new NotFoundException("Bengkel tidak ditemukan");
    if (company.businessUnit !== "BENGKEL") {
      throw new NotFoundException(
        "Booking publik hanya tersedia untuk bengkel",
      );
    }
    const branches = await this.prisma.branch.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        latitude: true,
        longitude: true,
      },
    });
    return {
      data: {
        company: {
          name: company.name,
          address: company.address,
          phone: company.phone,
        },
        branches,
      },
    };
  }

  /**
   * POST /public/bookings/:slug/lookup — cek apakah nomor HP sudah ada di
   * database customer company tsb. Kalau ada, FE skip OTP step + auto-fill
   * nama + tampilkan kendaraan customer.
   */
  @Public()
  @Post(":slug/lookup")
  async lookupCustomer(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(PublicLookupSchema))
    body: { phone: string },
  ) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: { id: true, businessUnit: true },
    });
    if (!company || company.businessUnit !== "BENGKEL") {
      throw new NotFoundException("Bengkel tidak ditemukan");
    }
    const phone = normalizePhone(body.phone);
    // Customer phone di DB bisa stored dalam format inkonsisten (kasir input
    // "0857..." atau "+62857..." atau "62857..."). Match multi-format supaya
    // lookup robust.
    const phoneVariants = Array.from(
      new Set([
        phone, // normalized 62-prefix
        body.phone.trim(), // raw user input
        phone.startsWith("62") ? "0" + phone.slice(2) : phone, // 0-prefix
        phone.startsWith("62") ? "+" + phone : phone, // +62 prefix
      ]),
    );
    const customer = await this.prisma.customer.findFirst({
      where: {
        companyId: company.id,
        phone: { in: phoneVariants },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        vehicles: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            plateNumber: true,
            type: true,
            brand: { select: { name: true } },
            modelRef: { select: { name: true } },
          },
        },
      },
    });
    if (!customer) {
      return { data: { found: false } };
    }
    return {
      data: {
        found: true,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        },
        vehicles: customer.vehicles.map((v) => ({
          id: v.id,
          plateNumber: v.plateNumber,
          type: v.type,
          brand: v.brand?.name ?? null,
          model: v.modelRef?.name ?? null,
        })),
      },
    };
  }

  /**
   * POST /public/bookings/:slug/otp/request — generate OTP 6-digit dan
   * kirim ke nomor WA customer via Baileys session admin. Rate limit 30s
   * supaya nomor tidak di-flood.
   */
  @Public()
  @Post(":slug/otp/request")
  async requestOtp(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(PublicOtpRequestSchema))
    body: { phone: string },
  ) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: { id: true, name: true, businessUnit: true },
    });
    if (!company || company.businessUnit !== "BENGKEL") {
      throw new NotFoundException("Bengkel tidak ditemukan");
    }

    const phone = normalizePhone(body.phone);
    const rateKey = `pb:otp:rate:${slug}:${phone}`;
    const otpKey = `pb:otp:code:${slug}:${phone}`;

    // Rate limit — kalau key rate masih hidup, tolak.
    const rateActive = await this.redis.get(rateKey);
    if (rateActive) {
      throw new BadRequestException(
        "Tunggu beberapa detik sebelum minta OTP baru.",
      );
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.redis.set(otpKey, code, OTP_TTL_SEC);
    await this.redis.set(rateKey, "1", OTP_RATE_LIMIT_SEC);

    // Compose pesan OTP
    const message = [
      `*${company.name}* — Kode OTP Booking`,
      "",
      `Kode verifikasi Anda: *${code}*`,
      "",
      `Berlaku ${OTP_TTL_SEC / 60} menit. Jangan bagikan kode ini ke siapa pun.`,
    ].join("\n");

    try {
      await this.waReceipt.sendText(company.id, phone, message);
    } catch (err) {
      // Hapus OTP supaya tidak nyangkut tanpa pesan terkirim.
      await this.redis.del(otpKey);
      await this.redis.del(rateKey);
      throw new BadRequestException(
        err instanceof Error
          ? `Gagal kirim OTP: ${err.message}`
          : "Gagal kirim OTP",
      );
    }

    return {
      data: {
        sent: true,
        expiresInSec: OTP_TTL_SEC,
        cooldownSec: OTP_RATE_LIMIT_SEC,
      },
    };
  }

  /**
   * POST /public/bookings/:slug/otp/verify — cek kode OTP, kalau benar
   * return verifiedToken yang dipakai saat submit booking.
   */
  @Public()
  @Post(":slug/otp/verify")
  async verifyOtp(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(PublicOtpVerifySchema))
    body: { phone: string; code: string },
  ) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: { id: true, businessUnit: true },
    });
    if (!company || company.businessUnit !== "BENGKEL") {
      throw new NotFoundException("Bengkel tidak ditemukan");
    }

    const phone = normalizePhone(body.phone);
    const otpKey = `pb:otp:code:${slug}:${phone}`;
    const stored = await this.redis.get(otpKey);
    if (!stored) {
      throw new BadRequestException(
        "OTP tidak ditemukan / sudah kadaluarsa. Minta ulang.",
      );
    }
    if (stored !== body.code) {
      throw new BadRequestException("Kode OTP salah.");
    }

    // OTP benar — issue verifiedToken (UUID), simpan di Redis dengan TTL.
    const token = randomUUID();
    const tokenKey = `pb:otp:token:${slug}:${token}`;
    await this.redis.set(tokenKey, phone, VERIFIED_TOKEN_TTL_SEC);
    // Hapus OTP supaya tidak bisa dipakai ulang.
    await this.redis.del(otpKey);

    return {
      data: {
        verifiedToken: token,
        expiresInSec: VERIFIED_TOKEN_TTL_SEC,
      },
    };
  }

  /** POST /public/bookings/:slug — buat booking baru status PENDING. */
  @Public()
  @Post(":slug")
  async create(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(PublicCreateBookingSchema))
    body: PublicCreateBookingDto,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: { id: true, businessUnit: true },
    });
    if (!company) throw new NotFoundException("Bengkel tidak ditemukan");
    if (company.businessUnit !== "BENGKEL") {
      throw new NotFoundException(
        "Booking publik hanya tersedia untuk bengkel",
      );
    }

    const phone = normalizePhone(body.customerPhone);

    // Customer existing flow: kalau body bawa existingCustomerId, verify
    // di DB bahwa customer itu memang punya phone yang sama → skip OTP.
    // Kalau tidak match, fallback ke OTP flow.
    let skipOtp = false;
    if (body.existingCustomerId) {
      const phoneVariants = Array.from(
        new Set([
          phone,
          body.customerPhone.trim(),
          phone.startsWith("62") ? "0" + phone.slice(2) : phone,
          phone.startsWith("62") ? "+" + phone : phone,
        ]),
      );
      const existing = await this.prisma.customer.findFirst({
        where: {
          id: body.existingCustomerId,
          companyId: company.id,
          phone: { in: phoneVariants },
        },
        select: { id: true },
      });
      if (existing) skipOtp = true;
    }

    if (!skipOtp) {
      // Validasi verifiedToken — cek di Redis bahwa token cocok dengan
      // nomor yang ada di body.
      if (!body.verifiedToken) {
        throw new BadRequestException(
          "Verifikasi nomor WhatsApp dulu (kirim OTP).",
        );
      }
      const tokenKey = `pb:otp:token:${slug}:${body.verifiedToken}`;
      const tokenPhone = await this.redis.get(tokenKey);
      if (!tokenPhone) {
        throw new BadRequestException(
          "Token verifikasi tidak valid / kadaluarsa. Verifikasi ulang nomor WA.",
        );
      }
      if (tokenPhone !== phone) {
        throw new BadRequestException(
          "Nomor WA tidak sama dengan yang di-verifikasi.",
        );
      }
    }

    // Susun notes terstruktur — vehicle info + complaint masuk ke notes
    // karena Booking model tidak punya field vehicle public-input langsung.
    // Staff bisa link ke vehicleId real saat konfirmasi.
    const typeIcon = body.vehicleType === "MOTOR" ? "🏍️" : "🚗";
    const noteParts: string[] = [];
    noteParts.push(
      `${typeIcon} ${body.vehicleType} · ${body.vehiclePlate}` +
        (body.vehicleBrand ? ` · ${body.vehicleBrand}` : "") +
        (body.vehicleModel ? ` ${body.vehicleModel}` : ""),
    );
    if (body.complaint?.trim()) {
      noteParts.push(`💬 Keluhan: ${body.complaint.trim()}`);
    }

    const created = await this.bookingsService.create(
      company.id,
      {
        branchId: body.branchId,
        bookingType: "BENGKEL",
        scheduledAt: body.scheduledAt,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        serviceType: body.serviceType,
        notes: noteParts.join("\n"),
      },
      null,
    );

    // Token sekali pakai — hapus supaya tidak bisa di-replay.
    if (!skipOtp && body.verifiedToken) {
      await this.redis.del(`pb:otp:token:${slug}:${body.verifiedToken}`);
    }

    // Emit realtime supaya staff dashboard dapat notifikasi instant.
    // Backend stamp branchId di payload — frontend bisa filter per branch
    // selected user (kalau admin pilih "Semua Lokasi", semua event masuk).
    this.realtime.emit(
      EVENTS.BOOKING_CREATED,
      {
        id: created.id,
        companyId: company.id,
        branchId: body.branchId,
        bookingType: "BENGKEL",
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        vehicleType: body.vehicleType,
        vehiclePlate: body.vehiclePlate,
        serviceType: body.serviceType,
        scheduledAt: created.scheduledAt,
      },
      body.branchId,
    );

    return {
      data: {
        id: created.id,
        scheduledAt: created.scheduledAt,
        status: created.status,
      },
    };
  }
}
