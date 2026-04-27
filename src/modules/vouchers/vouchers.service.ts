import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  GenerateVouchersDto,
  ListVouchersQueryDto,
  RedeemVoucherDto,
  VoucherGenerateResponse,
  VoucherListResponse,
  VoucherResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const VOUCHER_SELECT = {
  id: true,
  code: true,
  promotionId: true,
  isUsed: true,
  usedBy: true,
  usedAt: true,
  expiresAt: true,
  createdAt: true,
  promotion: {
    select: {
      id: true,
      name: true,
      type: true,
      value: true,
      voucherCode: true,
      isActive: true,
      companyId: true,
    },
  },
} satisfies Prisma.VoucherSelect;

type RawVoucher = Prisma.VoucherGetPayload<{ select: typeof VOUCHER_SELECT }>;

const MAX_GENERATE_ATTEMPTS = 5;

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListVouchersQueryDto,
  ): Promise<VoucherListResponse> {
    const { promotionId, isUsed, search, page, perPage } = query;

    const where: Prisma.VoucherWhereInput = {
      promotion: { companyId },
    };
    if (promotionId) where.promotionId = promotionId;
    if (isUsed !== undefined) where.isUsed = isUsed;
    if (search) {
      where.code = { contains: search, mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        select: VOUCHER_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.voucher.count({ where }),
    ]);

    return {
      vouchers: rows.map(toVoucherResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<VoucherResponse> {
    const voucher = await this.prisma.voucher.findFirst({
      where: { id, promotion: { companyId } },
      select: VOUCHER_SELECT,
    });
    if (!voucher) throw new NotFoundException("Voucher not found");
    return toVoucherResponse(voucher);
  }

  async findByCode(
    companyId: string,
    code: string,
  ): Promise<VoucherResponse | null> {
    const voucher = await this.prisma.voucher.findFirst({
      where: { code, promotion: { companyId } },
      select: VOUCHER_SELECT,
    });
    return voucher ? toVoucherResponse(voucher) : null;
  }

  async generate(
    companyId: string,
    dto: GenerateVouchersDto,
  ): Promise<VoucherGenerateResponse> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id: dto.promotionId, companyId },
      select: { id: true },
    });
    if (!promotion) throw new NotFoundException("Promotion not found");

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const codes = new Set<string>();
    for (let i = 0; i < MAX_GENERATE_ATTEMPTS && codes.size < dto.count; i++) {
      while (codes.size < dto.count) {
        codes.add(buildVoucherCode(dto.prefix));
      }
      // De-duplicate against existing DB codes
      const existing = await this.prisma.voucher.findMany({
        where: { code: { in: Array.from(codes) } },
        select: { code: true },
      });
      if (existing.length === 0) break;
      for (const row of existing) codes.delete(row.code);
    }

    if (codes.size < dto.count) {
      throw new ConflictException(
        "Gagal menghasilkan kode voucher unik, silakan coba lagi",
      );
    }

    const list = Array.from(codes);
    try {
      const result = await this.prisma.voucher.createMany({
        data: list.map((code) => ({
          code,
          promotionId: dto.promotionId,
          expiresAt,
        })),
      });
      return { created: result.count, codes: list };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode voucher sudah digunakan");
      }
      throw err;
    }
  }

  async redeem(
    companyId: string,
    id: string,
    dto: RedeemVoucherDto,
  ): Promise<VoucherResponse> {
    const voucher = await this.prisma.voucher.findFirst({
      where: { id, promotion: { companyId } },
      select: {
        id: true,
        isUsed: true,
        expiresAt: true,
      },
    });
    if (!voucher) throw new NotFoundException("Voucher not found");
    if (voucher.isUsed) {
      throw new BadRequestException("Voucher sudah digunakan");
    }
    if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Voucher sudah kedaluwarsa");
    }

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        isUsed: true,
        usedAt: new Date(),
        usedBy: dto.usedBy ?? null,
      },
      select: VOUCHER_SELECT,
    });
    return toVoucherResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const voucher = await this.prisma.voucher.findFirst({
      where: { id, promotion: { companyId } },
      select: { id: true, isUsed: true },
    });
    if (!voucher) throw new NotFoundException("Voucher not found");
    if (voucher.isUsed) {
      throw new BadRequestException(
        "Voucher yang sudah digunakan tidak bisa dihapus",
      );
    }
    await this.prisma.voucher.delete({ where: { id } });
    return { success: true };
  }
}

function buildVoucherCode(prefix?: string): string {
  if (prefix && prefix.length > 0) {
    const hex = randomBytes(4).toString("hex").toUpperCase();
    return `${prefix}-${hex}`;
  }
  return randomBytes(6).toString("hex").toUpperCase();
}

function toVoucherResponse(v: RawVoucher): VoucherResponse {
  return {
    id: v.id,
    code: v.code,
    promotionId: v.promotionId,
    promotion: v.promotion
      ? {
          id: v.promotion.id,
          name: v.promotion.name,
          type: v.promotion.type,
          value: v.promotion.value,
          voucherCode: v.promotion.voucherCode,
          isActive: v.promotion.isActive,
        }
      : null,
    isUsed: v.isUsed,
    usedBy: v.usedBy,
    usedAt: v.usedAt ? v.usedAt.toISOString() : null,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}
