import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

const LIST_INCLUDE = {
  branch: { select: { id: true, name: true } },
  items: { select: { quantity: true, baseQuantity: true } },
} satisfies Prisma.StockUsageInclude;

const DETAIL_INCLUDE = {
  branch: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, code: true, unit: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.StockUsageInclude;

export type RawUsageList = Prisma.StockUsageGetPayload<{
  include: typeof LIST_INCLUDE;
}>;
export type RawUsageDetail = Prisma.StockUsageGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

@Injectable()
export class StockUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBranch(branchId: string, companyId: string) {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true, name: true },
    });
  }

  findBranchStock(branchId: string, productId: string) {
    return this.prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { quantity: true },
    });
  }

  findProductUnit(unitId: string, productId: string) {
    return this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true, conversionQty: true },
    });
  }

  // Jumlah dokumen hari ini (per company) untuk sequence nomor.
  countByNumberPrefix(companyId: string, prefix: string) {
    return this.prisma.stockUsage.count({
      where: { companyId, usageNumber: { startsWith: prefix } },
    });
  }

  createHeader(data: Prisma.StockUsageCreateInput) {
    return this.prisma.stockUsage.create({ data, select: { id: true } });
  }

  createItem(data: Prisma.StockUsageItemUncheckedCreateInput) {
    return this.prisma.stockUsageItem.create({ data, select: { id: true } });
  }

  async findMany(
    where: Prisma.StockUsageWhereInput,
    skip: number,
    take: number,
  ): Promise<[RawUsageList[], number]> {
    return Promise.all([
      this.prisma.stockUsage.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      this.prisma.stockUsage.count({ where }),
    ]);
  }

  findOne(id: string, companyId: string): Promise<RawUsageDetail | null> {
    return this.prisma.stockUsage.findFirst({
      where: { id, companyId },
      include: DETAIL_INCLUDE,
    });
  }
}
