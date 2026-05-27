import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const TRANSFER_ITEM_SELECT = {
  id: true,
  stockTransferId: true,
  productId: true,
  productName: true,
  quantity: true,
  receivedQty: true,
  createdAt: true,
} satisfies Prisma.StockTransferItemSelect;

export const TRANSFER_SELECT = {
  id: true,
  transferNumber: true,
  fromBranchId: true,
  fromBranch: { select: { id: true, name: true, companyId: true } },
  toBranchId: true,
  toBranch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  notes: true,
  requestedBy: true,
  approvedBy: true,
  requestedAt: true,
  approvedAt: true,
  receivedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.StockTransferSelect;

export const TRANSFER_DETAIL_SELECT = {
  ...TRANSFER_SELECT,
  items: { select: TRANSFER_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.StockTransferSelect;

export type RawTransfer = Prisma.StockTransferGetPayload<{
  select: typeof TRANSFER_SELECT;
}>;
export type RawTransferDetail = Prisma.StockTransferGetPayload<{
  select: typeof TRANSFER_DETAIL_SELECT;
}>;
export type RawTransferItem = Prisma.StockTransferItemGetPayload<{
  select: typeof TRANSFER_ITEM_SELECT;
}>;

@Injectable()
export class StockTransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.StockTransferWhereInput,
    skip: number,
    take: number,
  ): Promise<RawTransfer[]> {
    return this.prisma.stockTransfer.findMany({
      where,
      select: TRANSFER_SELECT,
      orderBy: { requestedAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.StockTransferWhereInput): Promise<number> {
    return this.prisma.stockTransfer.count({ where });
  }

  async findOne(
    where: Prisma.StockTransferWhereInput,
  ): Promise<RawTransferDetail | null> {
    return this.prisma.stockTransfer.findFirst({
      where,
      select: TRANSFER_DETAIL_SELECT,
    });
  }

  async groupByStatus(where: Prisma.StockTransferWhereInput) {
    return this.prisma.stockTransfer.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
  }

  async findForSend(where: Prisma.StockTransferWhereInput) {
    return this.prisma.stockTransfer.findFirst({
      where,
      select: {
        id: true,
        transferNumber: true,
        status: true,
        fromBranchId: true,
        items: {
          select: { productId: true, productName: true, quantity: true },
        },
      },
    });
  }

  async findForReceive(where: Prisma.StockTransferWhereInput) {
    return this.prisma.stockTransfer.findFirst({
      where,
      select: {
        id: true,
        transferNumber: true,
        status: true,
        toBranchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            receivedQty: true,
          },
        },
      },
    });
  }

  async findForCancel(where: Prisma.StockTransferWhereInput) {
    return this.prisma.stockTransfer.findFirst({
      where,
      select: {
        id: true,
        transferNumber: true,
        status: true,
        fromBranchId: true,
        items: {
          select: { productId: true, productName: true, quantity: true },
        },
      },
    });
  }

  async findStatus(
    where: Prisma.StockTransferWhereInput,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.stockTransfer.findFirst({
      where,
      select: { id: true, status: true },
    });
  }

  async findProducts(
    productIds: string[],
    companyId: string,
  ): Promise<{ id: string; name: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async findProductDetails(
    items: { productId: string }[],
  ): Promise<Map<string, { id: string; code: string; name: string }>> {
    const ids = Array.from(new Set(items.map((it) => it.productId)));
    if (ids.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  async findBranchStocks(
    branchId: string,
    productIds: string[],
  ): Promise<{ productId: string; quantity: number }[]> {
    return this.prisma.branchStock.findMany({
      where: {
        branchId,
        productId: { in: productIds },
      },
      select: { productId: true, quantity: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.stockTransfer.delete({ where: { id } });
  }

  async countForNumber(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.stockTransfer.count({
      where: { companyId, createdAt: { gte: start, lt: end } },
    });
  }

  async existsByNumber(
    companyId: string,
    transferNumber: string,
  ): Promise<boolean> {
    const found = await this.prisma.stockTransfer.findFirst({
      where: { companyId, transferNumber },
      select: { id: true },
    });
    return !!found;
  }
}
