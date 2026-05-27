import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const VOUCHER_SELECT = {
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

export type RawVoucher = Prisma.VoucherGetPayload<{
  select: typeof VOUCHER_SELECT;
}>;

@Injectable()
export class VouchersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.VoucherWhereInput,
    skip: number,
    take: number,
  ): Promise<RawVoucher[]> {
    return this.prisma.voucher.findMany({
      where,
      select: VOUCHER_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.VoucherWhereInput): Promise<number> {
    return this.prisma.voucher.count({ where });
  }

  async findOne(where: Prisma.VoucherWhereInput): Promise<RawVoucher | null> {
    return this.prisma.voucher.findFirst({
      where,
      select: VOUCHER_SELECT,
    });
  }

  async findMeta(where: Prisma.VoucherWhereInput) {
    return this.prisma.voucher.findFirst({
      where,
      select: { id: true, isUsed: true, expiresAt: true },
    });
  }

  async findPromotion(companyId: string, promotionId: string) {
    return this.prisma.promotion.findFirst({
      where: { id: promotionId, companyId },
      select: { id: true },
    });
  }

  async findExistingCodes(codes: string[]) {
    return this.prisma.voucher.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
  }

  async createMany(data: Prisma.VoucherCreateManyInput[]) {
    return this.prisma.voucher.createMany({ data });
  }

  async update(
    id: string,
    data: Prisma.VoucherUpdateInput,
  ): Promise<RawVoucher> {
    return this.prisma.voucher.update({
      where: { id },
      data,
      select: VOUCHER_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.voucher.delete({ where: { id } });
  }
}
