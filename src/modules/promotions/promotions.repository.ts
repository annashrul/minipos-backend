import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const PROMOTION_SELECT = {
  id: true,
  name: true,
  type: true,
  value: true,
  minPurchase: true,
  maxDiscount: true,
  scope: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  productId: true,
  product: { select: { id: true, name: true, code: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  buyQty: true,
  getQty: true,
  getProductId: true,
  unitId: true,
  unit: { select: { id: true, name: true } },
  voucherCode: true,
  usageLimit: true,
  usageCount: true,
  description: true,
  isActive: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  triggerProducts: {
    include: { product: { select: { id: true, name: true, code: true } } },
  },
  getProducts: {
    include: { product: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.PromotionSelect;

export type RawPromotion = Prisma.PromotionGetPayload<{
  select: typeof PROMOTION_SELECT;
}>;

@Injectable()
export class PromotionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.PromotionWhereInput,
    skip: number,
    take: number,
  ): Promise<RawPromotion[]> {
    return this.prisma.promotion.findMany({
      where,
      select: PROMOTION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.PromotionWhereInput): Promise<number> {
    return this.prisma.promotion.count({ where });
  }

  async findOne(
    where: Prisma.PromotionWhereInput,
  ): Promise<RawPromotion | null> {
    return this.prisma.promotion.findFirst({
      where,
      select: PROMOTION_SELECT,
    });
  }

  async findById(
    where: Prisma.PromotionWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.promotion.findFirst({
      where,
      select: { id: true },
    });
  }

  async create(
    data: Prisma.PromotionCreateInput | Prisma.PromotionUncheckedCreateInput,
  ): Promise<RawPromotion> {
    return this.prisma.promotion.create({
      data,
      select: PROMOTION_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.PromotionUpdateInput,
  ): Promise<RawPromotion> {
    return this.prisma.promotion.update({
      where: { id },
      data,
      select: PROMOTION_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.promotion.delete({ where: { id } });
  }

  async countAll(where: Prisma.PromotionWhereInput): Promise<number> {
    return this.prisma.promotion.count({ where });
  }

  async groupByType(where: Prisma.PromotionWhereInput) {
    return this.prisma.promotion.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    });
  }

  async fetchGetProducts(
    ids: string[],
  ): Promise<Map<string, { id: string; name: string; code: string }>> {
    if (!ids.length) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, code: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  async assertBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async assertCategory(
    companyId: string,
    categoryId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.category.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
  }

  async assertProduct(
    companyId: string,
    productId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
  }

  async assertProducts(
    companyId: string,
    productIds: string[],
  ): Promise<{ id: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });
  }
}
