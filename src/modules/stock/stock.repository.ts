import { Injectable } from "@nestjs/common";
import { Prisma, type StockMovementType } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// SELECT constants & Raw types
// ─────────────────────────────────────────────────────────────────────────────

export const MOVEMENT_SELECT = {
  id: true,
  productId: true,
  product: { select: { id: true, name: true, code: true, unit: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  variantId: true,
  variantLabel: true,
  unitId: true,
  unit: { select: { id: true, name: true, conversionQty: true } },
  unitQuantity: true,
  type: true,
  quantity: true,
  note: true,
  reference: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.StockMovementSelect;

export type RawMovement = Prisma.StockMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

export const BRANCH_STOCK_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  product: {
    select: { id: true, code: true, name: true, unit: true },
  },
  quantity: true,
  minStock: true,
  updatedAt: true,
} satisfies Prisma.BranchStockSelect;

export type RawBranchStock = Prisma.BranchStockGetPayload<{
  select: typeof BRANCH_STOCK_SELECT;
}>;

export const STOCK_CARD_MOVEMENT_SELECT = {
  id: true,
  type: true,
  direction: true,
  quantity: true,
  balanceAfter: true,
  unitCost: true,
  totalCost: true,
  refType: true,
  refId: true,
  refNumber: true,
  reference: true,
  note: true,
  createdBy: true,
  createdAt: true,
  variantId: true,
  variantLabel: true,
  branch: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementSelect;

export type RawStockCardMovement = Prisma.StockMovementGetPayload<{
  select: typeof STOCK_CARD_MOVEMENT_SELECT;
}>;

@Injectable()
export class StockRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // StockMovement queries
  // ─────────────────────────────────────────────────────────────────────────

  async findManyMovements(
    where: Prisma.StockMovementWhereInput,
    skip: number,
    take: number,
  ): Promise<RawMovement[]> {
    return this.prisma.stockMovement.findMany({
      where,
      select: MOVEMENT_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countMovements(
    where: Prisma.StockMovementWhereInput,
  ): Promise<number> {
    return this.prisma.stockMovement.count({ where });
  }

  async countMovementsByTypeGroups(
    baseWhere: Prisma.StockMovementWhereInput,
    typeGroups: Record<string, StockMovementType[]>,
  ): Promise<Record<string, number>> {
    const keys = Object.keys(typeGroups);
    const counts = await Promise.all([
      ...keys.map((key) =>
        this.prisma.stockMovement.count({
          where: { ...baseWhere, type: { in: typeGroups[key] } },
        }),
      ),
      this.prisma.stockMovement.count({ where: baseWhere }),
    ]);

    const result: Record<string, number> = {};
    keys.forEach((key, idx) => {
      result[key] = counts[idx];
    });
    result.total = counts[keys.length];
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BranchStock queries
  // ─────────────────────────────────────────────────────────────────────────

  async findBranch(
    branchId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async findBranchWithName(
    branchId: string,
    companyId: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true, name: true },
    });
  }

  async findManyBranchStock(
    where: Prisma.BranchStockWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBranchStock[]> {
    return this.prisma.branchStock.findMany({
      where,
      select: BRANCH_STOCK_SELECT,
      orderBy: { product: { name: "asc" } },
      skip,
      take,
    });
  }

  async countBranchStock(
    where: Prisma.BranchStockWhereInput,
  ): Promise<number> {
    return this.prisma.branchStock.count({ where });
  }

  async findBranchStockByProduct(
    productId: string,
  ): Promise<{ branchId: string; quantity: number; minStock: number }[]> {
    return this.prisma.branchStock.findMany({
      where: { productId },
      select: { branchId: true, quantity: true, minStock: true },
    });
  }

  async findBranchStockUnique(
    branchId: string,
    productId: string,
  ): Promise<{ quantity: number } | null> {
    return this.prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { quantity: true },
    });
  }

  async aggregateBranchStock(
    productId: string,
  ): Promise<number> {
    const result = await this.prisma.branchStock.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  /**
   * Access the `branchStock.fields.minStock` reference for Prisma's
   * column-level comparison (used for low-stock filtering).
   */
  get branchStockMinStockField() {
    return this.prisma.branchStock.fields.minStock;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Product queries
  // ─────────────────────────────────────────────────────────────────────────

  async findProduct(
    productId: string,
    companyId: string,
  ): Promise<{ id: string; stock: number } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, stock: true },
    });
  }

  async findProductForCard(
    productId: string,
    companyId: string,
  ) {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true, name: true, code: true, unit: true },
    });
  }

  async findProductUnit(
    unitId: string,
    productId: string,
  ): Promise<{ id: string; conversionQty: number } | null> {
    return this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true, conversionQty: true },
    });
  }

  async findProductVariant(
    variantId: string,
    productId: string,
  ) {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      include: {
        options: { select: { option: { select: { name: true } } } },
      },
    });
  }

  async findProductVariants(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      select: {
        id: true,
        options: {
          select: { option: { select: { name: true } } },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stock card queries
  // ─────────────────────────────────────────────────────────────────────────

  async findStockCardMovements(
    where: Prisma.StockMovementWhereInput,
    skip: number,
    take: number,
  ): Promise<RawStockCardMovement[]> {
    return this.prisma.stockMovement.findMany({
      where,
      select: STOCK_CARD_MOVEMENT_SELECT,
      orderBy: { createdAt: "asc" },
      skip,
      take,
    });
  }

  async findMovementsForBalance(
    where: Prisma.StockMovementWhereInput,
  ): Promise<{ type: string; quantity: number; direction: string | null }[]> {
    return this.prisma.stockMovement.findMany({
      where,
      select: { type: true, quantity: true, direction: true },
    });
  }

  async findMovementsForPeriodAgg(
    where: Prisma.StockMovementWhereInput,
  ): Promise<{ type: string; quantity: number; direction: string | null }[]> {
    return this.prisma.stockMovement.findMany({
      where,
      select: { type: true, quantity: true, direction: true },
    });
  }
}
