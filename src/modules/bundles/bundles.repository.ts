import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const BUNDLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  imageUrl: true,
  sellingPrice: true,
  totalBasePrice: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  barcode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          sellingPrice: true,
          purchasePrice: true,
        },
      },
      quantity: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.ProductBundleSelect;

export type RawBundle = Prisma.ProductBundleGetPayload<{
  select: typeof BUNDLE_SELECT;
}>;

@Injectable()
export class BundlesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.ProductBundleWhereInput,
    orderBy: Prisma.ProductBundleOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawBundle[]> {
    return this.prisma.productBundle.findMany({
      where,
      select: BUNDLE_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.ProductBundleWhereInput): Promise<number> {
    return this.prisma.productBundle.count({ where });
  }

  async findOne(
    where: Prisma.ProductBundleWhereInput,
  ): Promise<RawBundle | null> {
    return this.prisma.productBundle.findFirst({
      where,
      select: BUNDLE_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.productBundle.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
  }

  async create(
    data: Prisma.ProductBundleUncheckedCreateInput,
  ): Promise<RawBundle> {
    return this.prisma.productBundle.create({
      data,
      select: BUNDLE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productBundle.delete({ where: { id } });
  }

  async deleteMany(
    companyId: string,
    ids: string[],
  ): Promise<number> {
    const { count } = await this.prisma.productBundle.deleteMany({
      where: { id: { in: ids }, companyId },
    });
    return count;
  }

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async findCategory(
    companyId: string,
    categoryId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.category.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
  }

  async findProducts(
    companyId: string,
    productIds: string[],
  ): Promise<{ id: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });
  }

  async findProductPrices(
    productIds: string[],
  ): Promise<{ id: string; sellingPrice: number }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sellingPrice: true },
    });
  }
}
