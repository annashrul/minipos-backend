import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const LOW_STOCK_PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  minStock: true,
} satisfies Prisma.ProductSelect;

export type RawLowStockProduct = Prisma.ProductGetPayload<{
  select: typeof LOW_STOCK_PRODUCT_SELECT;
}>;

export const EXPIRING_PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  expiryDate: true,
} satisfies Prisma.ProductSelect;

export type RawExpiringProduct = Prisma.ProductGetPayload<{
  select: typeof EXPIRING_PRODUCT_SELECT;
}>;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLowStockCandidates(
    companyId: string,
    take: number,
  ): Promise<RawLowStockProduct[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
      },
      select: LOW_STOCK_PRODUCT_SELECT,
      orderBy: { stock: "asc" },
      take,
    });
  }

  async findExpiringProducts(
    companyId: string,
    expiryBefore: Date,
    take: number,
  ): Promise<RawExpiringProduct[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
        expiryDate: { not: null, lte: expiryBefore },
      },
      select: EXPIRING_PRODUCT_SELECT,
      orderBy: { expiryDate: "asc" },
      take,
    });
  }
}
