import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { tenantWhere } from "@/common/utils/tenant";

export const OPNAME_ITEM_SELECT = {
  id: true,
  stockOpnameId: true,
  productId: true,
  product: { select: { id: true, code: true, name: true } },
  systemStock: true,
  actualStock: true,
  difference: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.StockOpnameItemSelect;

export const OPNAME_SELECT = {
  id: true,
  opnameNumber: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  notes: true,
  startedAt: true,
  completedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.StockOpnameSelect;

export const OPNAME_DETAIL_SELECT = {
  ...OPNAME_SELECT,
  items: { select: OPNAME_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.StockOpnameSelect;

export type RawOpname = Prisma.StockOpnameGetPayload<{
  select: typeof OPNAME_SELECT;
}>;
export type RawOpnameDetail = Prisma.StockOpnameGetPayload<{
  select: typeof OPNAME_DETAIL_SELECT;
}>;
export type RawOpnameItem = Prisma.StockOpnameItemGetPayload<{
  select: typeof OPNAME_ITEM_SELECT;
}>;

@Injectable()
export class StockOpnameRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.StockOpnameWhereInput,
    skip: number,
    take: number,
  ): Promise<RawOpname[]> {
    return this.prisma.stockOpname.findMany({
      where,
      select: OPNAME_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.StockOpnameWhereInput): Promise<number> {
    return this.prisma.stockOpname.count({ where });
  }

  async findOne(
    where: Prisma.StockOpnameWhereInput,
  ): Promise<RawOpnameDetail | null> {
    return this.prisma.stockOpname.findFirst({
      where,
      select: OPNAME_DETAIL_SELECT,
    });
  }

  async findStatus(
    where: Prisma.StockOpnameWhereInput,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.stockOpname.findFirst({
      where,
      select: { id: true, status: true },
    });
  }

  async findStatusWithBranch(
    where: Prisma.StockOpnameWhereInput,
  ): Promise<{ id: string; status: string; branchId: string | null } | null> {
    return this.prisma.stockOpname.findFirst({
      where,
      select: { id: true, status: true, branchId: true },
    });
  }

  async findForComplete(where: Prisma.StockOpnameWhereInput) {
    return this.prisma.stockOpname.findFirst({
      where,
      select: {
        id: true,
        opnameNumber: true,
        status: true,
        branchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            systemStock: true,
            actualStock: true,
            difference: true,
          },
        },
      },
    });
  }

  async findDetail(id: string): Promise<RawOpnameDetail> {
    return this.prisma.stockOpname.findUniqueOrThrow({
      where: { id },
      select: OPNAME_DETAIL_SELECT,
    });
  }

  async create(
    data: Prisma.StockOpnameUncheckedCreateInput,
  ): Promise<RawOpnameDetail> {
    return this.prisma.stockOpname.create({
      data,
      select: OPNAME_DETAIL_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.StockOpnameUpdateInput,
  ): Promise<void> {
    await this.prisma.stockOpname.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.stockOpname.delete({ where: { id } });
  }

  async findProducts(
    productIds: string[],
    companyId: string,
  ): Promise<{ id: string; stock: number }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, stock: true },
    });
  }

  async findBranchStocks(
    branchId: string,
    productIds: string[],
  ): Promise<{ productId: string; quantity: number }[]> {
    return this.prisma.branchStock.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    });
  }

  async countForNumber(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.stockOpname.count({
      where: { companyId, createdAt: { gte: start, lt: end } },
    });
  }

  async existsByNumber(
    companyId: string,
    opnameNumber: string,
  ): Promise<boolean> {
    const found = await this.prisma.stockOpname.findFirst({
      where: { companyId, opnameNumber },
      select: { id: true },
    });
    return !!found;
  }
}
