import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const GOODS_RECEIPT_LIST_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  purchaseOrder: {
    select: {
      orderNumber: true,
      totalAmount: true,
      status: true,
      supplier: { select: { name: true } },
    },
  },
  _count: { select: { items: true } },
} satisfies Prisma.GoodsReceiptSelect;

export const GOODS_RECEIPT_DETAIL_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  purchaseOrder: {
    select: {
      orderNumber: true,
      orderDate: true,
      status: true,
      totalAmount: true,
      supplier: {
        select: { name: true, contact: true, address: true },
      },
    },
  },
  items: {
    select: {
      id: true,
      goodsReceiptId: true,
      productId: true,
      productName: true,
      quantityOrdered: true,
      quantityReceived: true,
      unitPrice: true,
      previousPurchasePrice: true,
      notes: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.GoodsReceiptSelect;

export type RawGoodsReceiptList = Prisma.GoodsReceiptGetPayload<{
  select: typeof GOODS_RECEIPT_LIST_SELECT;
}>;
export type RawGoodsReceiptDetail = Prisma.GoodsReceiptGetPayload<{
  select: typeof GOODS_RECEIPT_DETAIL_SELECT;
}>;

@Injectable()
export class GoodsReceiptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.GoodsReceiptWhereInput,
    skip: number,
    take: number,
  ): Promise<RawGoodsReceiptList[]> {
    return this.prisma.goodsReceipt.findMany({
      where,
      select: GOODS_RECEIPT_LIST_SELECT,
      orderBy: { receivedAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.GoodsReceiptWhereInput): Promise<number> {
    return this.prisma.goodsReceipt.count({ where });
  }

  async findOne(
    where: Prisma.GoodsReceiptWhereInput,
  ): Promise<RawGoodsReceiptDetail | null> {
    return this.prisma.goodsReceipt.findFirst({
      where,
      select: GOODS_RECEIPT_DETAIL_SELECT,
    });
  }

  async findManyDetail(
    where: Prisma.GoodsReceiptWhereInput,
  ): Promise<RawGoodsReceiptDetail[]> {
    return this.prisma.goodsReceipt.findMany({
      where,
      select: GOODS_RECEIPT_DETAIL_SELECT,
      orderBy: { receivedAt: "desc" },
    });
  }

  async findById(
    where: Prisma.GoodsReceiptWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.goodsReceipt.findFirst({
      where,
      select: { id: true },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.goodsReceipt.delete({ where: { id } });
  }

  async deleteMany(
    where: Prisma.GoodsReceiptWhereInput,
  ): Promise<number> {
    const { count } = await this.prisma.goodsReceipt.deleteMany({ where });
    return count;
  }
}
