import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const RETURN_SELECT = {
  id: true,
  returnNumber: true,
  transactionId: true,
  transaction: { select: { id: true, invoiceNumber: true, invoiceDisplayNumber: true } },
  customerId: true,
  customer: { select: { id: true, name: true } },
  type: true,
  status: true,
  reason: true,
  notes: true,
  totalRefund: true,
  refundMethod: true,
  approvedBy: true,
  approvedAt: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  processedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReturnExchangeSelect;

export const RETURN_ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  product: { select: { id: true, code: true, name: true } },
  quantity: true,
  unitPrice: true,
  subtotal: true,
  reason: true,
  exchangeProductId: true,
  exchangeProduct: {
    select: { id: true, code: true, name: true, sellingPrice: true },
  },
  exchangeQuantity: true,
  restocked: true,
} satisfies Prisma.ReturnExchangeItemSelect;

export const RETURN_DETAIL_SELECT = {
  ...RETURN_SELECT,
  items: {
    select: RETURN_ITEM_SELECT,
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.ReturnExchangeSelect;

export type RawReturn = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_SELECT;
}>;
export type RawReturnDetail = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_DETAIL_SELECT;
}>;
export type RawReturnItem = Prisma.ReturnExchangeItemGetPayload<{
  select: typeof RETURN_ITEM_SELECT;
}>;

@Injectable()
export class ReturnsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // LIST / COUNT
  // ============================================================

  async findMany(
    where: Prisma.ReturnExchangeWhereInput,
    orderBy: Prisma.ReturnExchangeOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawReturn[]> {
    return this.prisma.returnExchange.findMany({
      where,
      select: RETURN_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.ReturnExchangeWhereInput): Promise<number> {
    return this.prisma.returnExchange.count({ where });
  }

  // ============================================================
  // DETAIL
  // ============================================================

  async findOneDetail(
    where: Prisma.ReturnExchangeWhereInput,
  ): Promise<RawReturnDetail | null> {
    return this.prisma.returnExchange.findFirst({
      where,
      select: RETURN_DETAIL_SELECT,
    });
  }

  // ============================================================
  // SUMMARY / AGGREGATION
  // ============================================================

  async groupByStatus(where: Prisma.ReturnExchangeWhereInput) {
    return this.prisma.returnExchange.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { totalRefund: true },
    });
  }

  async countByType(
    where: Prisma.ReturnExchangeWhereInput,
    type: string,
  ): Promise<number> {
    return this.prisma.returnExchange.count({
      where: { ...where, type },
    });
  }

  async aggregateTotalRefund(where: Prisma.ReturnExchangeWhereInput) {
    return this.prisma.returnExchange.aggregate({
      where,
      _sum: { totalRefund: true },
    });
  }

  // ============================================================
  // FIND FOR ACTIONS (approve / complete / reject / delete)
  // ============================================================

  async findForStatus(
    where: Prisma.ReturnExchangeWhereInput,
  ): Promise<{ id: string; status: string; notes: string | null } | null> {
    return this.prisma.returnExchange.findFirst({
      where,
      select: { id: true, status: true, notes: true },
    });
  }

  async findForApprove(where: Prisma.ReturnExchangeWhereInput) {
    return this.prisma.returnExchange.findFirst({
      where,
      select: {
        id: true,
        status: true,
        type: true,
        returnNumber: true,
        totalRefund: true,
        refundMethod: true,
        customerId: true,
        branchId: true,
        transactionId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            exchangeProductId: true,
            exchangeQuantity: true,
            restocked: true,
          },
        },
      },
    });
  }

  async findForComplete(where: Prisma.ReturnExchangeWhereInput) {
    return this.prisma.returnExchange.findFirst({
      where,
      select: {
        id: true,
        status: true,
        type: true,
        returnNumber: true,
        totalRefund: true,
        refundMethod: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            exchangeProductId: true,
            exchangeQuantity: true,
            restocked: true,
          },
        },
      },
    });
  }

  async findForDelete(
    where: Prisma.ReturnExchangeWhereInput,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.returnExchange.findFirst({
      where,
      select: { id: true, status: true },
    });
  }

  // ============================================================
  // REJECT (simple update, no transaction needed)
  // ============================================================

  async updateReturn(
    id: string,
    data: Prisma.ReturnExchangeUpdateInput,
  ): Promise<RawReturnDetail> {
    return this.prisma.returnExchange.update({
      where: { id },
      data,
      select: RETURN_DETAIL_SELECT,
    });
  }

  // ============================================================
  // TRANSACTION SEARCH
  // ============================================================

  async findTransaction(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDisplayNumber: true,
        userId: true,
        user: { select: { id: true, name: true } },
        branchId: true,
        branch: { select: { id: true, name: true } },
        customerId: true,
        customer: { select: { id: true, name: true } },
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        grandTotal: true,
        paymentMethod: true,
        paymentAmount: true,
        changeAmount: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            productCode: true,
            quantity: true,
            unitName: true,
            unitPrice: true,
            discount: true,
            subtotal: true,
          },
        },
      },
    });
  }

  async findTransactionForCreate(
    transactionId: string,
    companyId: string,
  ) {
    return this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        user: { companyId },
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            productName: true,
          },
        },
      },
    });
  }

  // ============================================================
  // PRIOR RETURNED QTY
  // ============================================================

  async groupPriorReturned(transactionId: string) {
    return this.prisma.returnExchangeItem.groupBy({
      by: ["productId"],
      where: {
        returnExchange: {
          transactionId,
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
      },
      _sum: { quantity: true },
    });
  }

  // ============================================================
  // EXCHANGE PRODUCTS
  // ============================================================

  async findExchangeProducts(
    ids: string[],
    companyId: string,
  ): Promise<{ id: string; sellingPrice: number; name: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, sellingPrice: true, name: true },
    });
  }

  async searchProducts(
    where: Prisma.ProductWhereInput,
    take: number,
  ) {
    return this.prisma.product.findMany({
      where,
      take,
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        imageUrl: true,
        unit: true,
      },
    });
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
}
