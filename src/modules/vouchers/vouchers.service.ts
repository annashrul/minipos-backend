import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  GenerateVouchersDto,
  ListVouchersQueryDto,
  RedeemVoucherDto,
  VoucherGenerateResponse,
  VoucherResponse,
} from "./dto/vouchers.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { VouchersRepository, type RawVoucher } from "./vouchers.repository";

const MAX_GENERATE_ATTEMPTS = 5;

@Injectable()
export class VouchersService {
  constructor(private readonly repo: VouchersRepository) {}

  async list(
    companyId: string,
    query: ListVouchersQueryDto,
  ): Promise<PaginatedResponse<VoucherResponse>> {
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
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toVoucherResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<VoucherResponse> {
    const voucher = await this.repo.findOne({ id, promotion: { companyId } });
    if (!voucher) throw new NotFoundException("Voucher tidak ditemukan");
    return toVoucherResponse(voucher);
  }

  async findByCode(
    companyId: string,
    code: string,
  ): Promise<VoucherResponse | null> {
    const voucher = await this.repo.findOne({
      code,
      promotion: { companyId },
    });
    return voucher ? toVoucherResponse(voucher) : null;
  }

  async generate(
    companyId: string,
    dto: GenerateVouchersDto,
  ): Promise<VoucherGenerateResponse> {
    const promotion = await this.repo.findPromotion(companyId, dto.promotionId);
    if (!promotion) throw new NotFoundException("Promosi tidak ditemukan");

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const codes = new Set<string>();
    for (let i = 0; i < MAX_GENERATE_ATTEMPTS && codes.size < dto.count; i++) {
      while (codes.size < dto.count) {
        codes.add(buildVoucherCode(dto.prefix));
      }
      const existing = await this.repo.findExistingCodes(Array.from(codes));
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
      const result = await this.repo.createMany(
        list.map((code) => ({
          code,
          promotionId: dto.promotionId,
          expiresAt,
        })),
      );
      return { created: result.count, codes: list };
    } catch (err) {
      throwIfUniqueConstraint(err, "Kode voucher sudah digunakan");
    }
  }

  async redeem(
    companyId: string,
    id: string,
    dto: RedeemVoucherDto,
  ): Promise<VoucherResponse> {
    const voucher = await this.repo.findMeta({
      id,
      promotion: { companyId },
    });
    if (!voucher) throw new NotFoundException("Voucher tidak ditemukan");
    if (voucher.isUsed) {
      throw new BadRequestException("Voucher sudah digunakan");
    }
    if (voucher.expiresAt && voucher.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Voucher sudah kedaluwarsa");
    }

    const updated = await this.repo.update(id, {
      isUsed: true,
      usedAt: new Date(),
      usedBy: dto.usedBy ?? null,
    });
    return toVoucherResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const voucher = await this.repo.findMeta({
      id,
      promotion: { companyId },
    });
    if (!voucher) throw new NotFoundException("Voucher tidak ditemukan");
    if (voucher.isUsed) {
      throw new BadRequestException(
        "Voucher yang sudah digunakan tidak bisa dihapus",
      );
    }
    await this.repo.delete(id);
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
