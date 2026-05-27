import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ============================================================
// PRODUCT UNITS
// ============================================================

export const UNIT_SELECT = {
  id: true,
  productId: true,
  name: true,
  conversionQty: true,
  sellingPrice: true,
  purchasePrice: true,
  barcode: true,
  isDefault: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductUnitSelect;

export type RawUnit = Prisma.ProductUnitGetPayload<{
  select: typeof UNIT_SELECT;
}>;

// ============================================================
// PRODUCT TIER PRICES
// ============================================================

export const TIER_SELECT = {
  id: true,
  productId: true,
  minQty: true,
  price: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductTierPriceSelect;

export type RawTier = Prisma.ProductTierPriceGetPayload<{
  select: typeof TIER_SELECT;
}>;

// ============================================================
// BRANCH PRODUCT PRICES
// ============================================================

export const BRANCH_PRICE_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  sellingPrice: true,
  purchasePrice: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, code: true, name: true } },
} satisfies Prisma.BranchProductPriceSelect;

export type RawBranchPrice = Prisma.BranchProductPriceGetPayload<{
  select: typeof BRANCH_PRICE_SELECT;
}>;

@Injectable()
export class ProductExtensionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // PRODUCT UNITS
  // ============================================================

  async findManyUnits(productId: string): Promise<RawUnit[]> {
    return this.prisma.productUnit.findMany({
      where: { productId },
      select: UNIT_SELECT,
      orderBy: { sortOrder: "asc" },
    });
  }

  async findUnit(
    unitId: string,
    productId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true },
    });
  }

  async findUnitWithDefault(
    unitId: string,
    productId: string,
  ): Promise<{ id: string; isDefault: boolean } | null> {
    return this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true, isDefault: true },
    });
  }

  async countOtherUnits(productId: string, unitId: string): Promise<number> {
    return this.prisma.productUnit.count({
      where: { productId, NOT: { id: unitId } },
    });
  }

  async deleteUnit(unitId: string): Promise<void> {
    await this.prisma.productUnit.delete({ where: { id: unitId } });
  }

  // ============================================================
  // PRODUCT TIER PRICES
  // ============================================================

  async findManyTierPrices(productId: string): Promise<RawTier[]> {
    return this.prisma.productTierPrice.findMany({
      where: { productId },
      select: TIER_SELECT,
      orderBy: { minQty: "asc" },
    });
  }

  async findTierPrice(
    tierId: string,
    productId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.productTierPrice.findFirst({
      where: { id: tierId, productId },
      select: { id: true },
    });
  }

  async createTierPrice(
    productId: string,
    data: { minQty: number; price: number },
  ): Promise<RawTier> {
    return this.prisma.productTierPrice.create({
      data: { productId, minQty: data.minQty, price: data.price },
      select: TIER_SELECT,
    });
  }

  async updateTierPrice(
    tierId: string,
    data: Prisma.ProductTierPriceUpdateInput,
  ): Promise<RawTier> {
    return this.prisma.productTierPrice.update({
      where: { id: tierId },
      data,
      select: TIER_SELECT,
    });
  }

  async deleteTierPrice(tierId: string): Promise<void> {
    await this.prisma.productTierPrice.delete({ where: { id: tierId } });
  }

  // ============================================================
  // BRANCH PRODUCT PRICES
  // ============================================================

  async findManyBranchPrices(
    where: Prisma.BranchProductPriceWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBranchPrice[]> {
    return this.prisma.branchProductPrice.findMany({
      where,
      select: BRANCH_PRICE_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countBranchPrices(
    where: Prisma.BranchProductPriceWhereInput,
  ): Promise<number> {
    return this.prisma.branchProductPrice.count({ where });
  }

  async findManyBranchPricesForProduct(
    productId: string,
  ): Promise<RawBranchPrice[]> {
    return this.prisma.branchProductPrice.findMany({
      where: { productId },
      select: BRANCH_PRICE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async findBranchPrice(
    id: string,
    productId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branchProductPrice.findFirst({
      where: { id, productId },
      select: { id: true },
    });
  }

  async createBranchPrice(
    data: Prisma.BranchProductPriceUncheckedCreateInput,
  ): Promise<RawBranchPrice> {
    return this.prisma.branchProductPrice.create({
      data,
      select: BRANCH_PRICE_SELECT,
    });
  }

  async updateBranchPrice(
    id: string,
    data: Prisma.BranchProductPriceUpdateInput,
  ): Promise<RawBranchPrice> {
    return this.prisma.branchProductPrice.update({
      where: { id },
      data,
      select: BRANCH_PRICE_SELECT,
    });
  }

  async deleteBranchPrice(id: string): Promise<void> {
    await this.prisma.branchProductPrice.delete({ where: { id } });
  }

  async findBranchIds(
    branchIds: string[],
    companyId: string,
  ): Promise<{ id: string }[]> {
    return this.prisma.branch.findMany({
      where: { id: { in: branchIds }, companyId },
      select: { id: true },
    });
  }

  // ============================================================
  // PRODUCTS WITH BRANCH PRICES (list view)
  // ============================================================

  async findProductsWithBranchPrices(
    where: Prisma.ProductWhereInput,
    branchId: string,
    skip: number,
    take: number,
  ) {
    return this.prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        purchasePrice: true,
        stock: true,
        unit: true,
        barcode: true,
        imageUrl: true,
        category: { select: { id: true, name: true } },
        branchPrices: {
          where: { branchId },
          select: {
            id: true,
            sellingPrice: true,
            purchasePrice: true,
          },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
      skip,
      take,
    });
  }

  async countProducts(where: Prisma.ProductWhereInput): Promise<number> {
    return this.prisma.product.count({ where });
  }

  // ============================================================
  // PRODUCT VARIANTS
  // ============================================================

  async findManyVariants(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      include: { options: { select: { optionId: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async findActiveVariants(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      include: { options: { select: { optionId: true } } },
    });
  }

  // ============================================================
  // PRODUCT BRANCH SKUS
  // ============================================================

  async findManyBranchSkus(productId: string) {
    return this.prisma.productBranchSku.findMany({
      where: { productId },
      orderBy: [{ branchId: "asc" }, { unitId: "asc" }, { variantId: "asc" }],
    });
  }

  async findBranchSku(
    productId: string,
    branchId: string,
    unitId: string | null,
    variantId: string | null,
  ) {
    return this.prisma.productBranchSku.findFirst({
      where: {
        productId,
        branchId,
        unitId: unitId ?? null,
        variantId: variantId ?? null,
        isActive: true,
      },
    });
  }
}
