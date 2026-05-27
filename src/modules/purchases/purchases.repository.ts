import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { dayRange, nextDocumentNumber } from "@/common/utils/document-number";
import { tenantWhere } from "@/common/utils/tenant";

// ─── SELECT constants ────────────────────────────────────────────────

export const PO_ITEM_SELECT = {
  id: true,
  purchaseOrderId: true,
  productId: true,
  product: {
    select: { id: true, code: true, name: true, purchasePrice: true },
  },
  unitId: true,
  unit: { select: { id: true, name: true, purchasePrice: true } },
  variantId: true,
  variant: {
    select: {
      id: true,
      purchasePriceOverride: true,
      options: {
        select: {
          option: { select: { name: true } },
        },
      },
    },
  },
  quantity: true,
  receivedQty: true,
  unitPrice: true,
  previousPurchasePrice: true,
  subtotal: true,
} satisfies Prisma.PurchaseOrderItemSelect;

export const PO_SELECT = {
  id: true,
  orderNumber: true,
  purchaseTransactionNumber: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, companyId: true } },
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  totalAmount: true,
  receivedAmount: true,
  paidAmount: true,
  notes: true,
  orderDate: true,
  expectedDate: true,
  receivedDate: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  items: { select: PO_ITEM_SELECT, orderBy: { createdAt: "asc" } },
  _count: { select: { goodsReceipts: true } },
} satisfies Prisma.PurchaseOrderSelect;

const RECEIPT_ITEM_SELECT = {
  id: true,
  goodsReceiptId: true,
  productId: true,
  productName: true,
  quantityOrdered: true,
  quantityReceived: true,
  unitPrice: true,
  previousPurchasePrice: true,
  notes: true,
} satisfies Prisma.GoodsReceiptItemSelect;

export const RECEIPT_SELECT = {
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
  items: { select: RECEIPT_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.GoodsReceiptSelect;

export const PO_DETAIL_SELECT = {
  ...PO_SELECT,
  goodsReceipts: { select: RECEIPT_SELECT, orderBy: { receivedAt: "desc" } },
} satisfies Prisma.PurchaseOrderSelect;

// ─── Raw types ───────────────────────────────────────────────────────

export type RawPO = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_SELECT;
}>;
export type RawPODetail = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_DETAIL_SELECT;
}>;
export type RawReceipt = Prisma.GoodsReceiptGetPayload<{
  select: typeof RECEIPT_SELECT;
}>;

// ─── Transaction log SELECT ──────────────────────────────────────────

const TX_LOG_SELECT = {
  id: true,
  purchaseOrderId: true,
  purchaseOrder: {
    select: {
      id: true,
      orderNumber: true,
      purchaseTransactionNumber: true,
      supplier: { select: { id: true, name: true } },
    },
  },
  branchId: true,
  documentNumber: true,
  documentType: true,
  status: true,
  amount: true,
  note: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.PurchaseTransactionLogSelect;

// ─── Repository ──────────────────────────────────────────────────────

@Injectable()
export class PurchasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── List & count ─────────────────────────────────────────────────

  findMany(
    where: Prisma.PurchaseOrderWhereInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.purchaseOrder.findMany({
      where,
      select: PO_SELECT,
      orderBy: { orderDate: "desc" },
      skip,
      take,
    });
  }

  count(where: Prisma.PurchaseOrderWhereInput) {
    return this.prisma.purchaseOrder.count({ where });
  }

  // ── Summary (aggregate + groupBy) ───────────────────────────────

  aggregate(where: Prisma.PurchaseOrderWhereInput) {
    return this.prisma.purchaseOrder.aggregate({
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
  }

  groupByStatus(where: Prisma.PurchaseOrderWhereInput) {
    return this.prisma.purchaseOrder.groupBy({
      by: ["status"],
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
  }

  // ── Find by id ──────────────────────────────────────────────────

  findById(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: PO_DETAIL_SELECT,
    });
  }

  findByIdForUpdate(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: { id: true, status: true },
    });
  }

  findByIdForStatusUpdate(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        branchId: true,
        totalAmount: true,
      },
    });
  }

  findByIdForReceive(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: {
        id: true,
        orderNumber: true,
        purchaseTransactionNumber: true,
        status: true,
        branchId: true,
        supplierId: true,
        supplier: { select: { id: true, name: true } },
        paidAmount: true,
        items: {
          select: {
            id: true,
            productId: true,
            unitId: true,
            unit: {
              select: { id: true, isDefault: true, conversionQty: true },
            },
            variantId: true,
            quantity: true,
            receivedQty: true,
            unitPrice: true,
            previousPurchasePrice: true,
            product: { select: { id: true, name: true } },
            variant: {
              select: {
                id: true,
                options: {
                  select: { option: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });
  }

  findByIdForClose(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: {
        id: true,
        orderNumber: true,
        purchaseTransactionNumber: true,
        status: true,
        totalAmount: true,
        receivedAmount: true,
        paidAmount: true,
        branchId: true,
        notes: true,
      },
    });
  }

  findByIdForDelete(companyId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId, "direct", "supplier", "branch") },
      select: {
        id: true,
        status: true,
        _count: { select: { goodsReceipts: true } },
      },
    });
  }

  deletePurchaseOrder(id: string) {
    return this.prisma.purchaseOrder.delete({ where: { id } });
  }

  // ── User lookup ─────────────────────────────────────────────────

  findUserName(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
  }

  // ── Old price lookups (for receive) ─────────────────────────────

  findProductUnitPrice(unitId: string) {
    return this.prisma.productUnit.findUnique({
      where: { id: unitId },
      select: { purchasePrice: true },
    });
  }

  findVariantPrice(variantId: string) {
    return this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        purchasePriceOverride: true,
        product: { select: { purchasePrice: true } },
      },
    });
  }

  findProductPrice(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      select: { purchasePrice: true },
    });
  }

  // ── Document number helpers ─────────────────────────────────────

  async nextPurchaseTransactionNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "BL",
      countToday: () =>
        this.prisma.purchaseOrder.count({
          where: { companyId, createdAt: { gte: start, lt: end } },
        }),
      exists: async (candidate) => {
        const found = await this.prisma.purchaseOrder.findFirst({
          where: { companyId, purchaseTransactionNumber: candidate },
          select: { id: true },
        });
        return !!found;
      },
    });
  }

  async nextOrderNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "PO",
      countToday: () =>
        this.prisma.purchaseOrder.count({
          where: { companyId, createdAt: { gte: start, lt: end } },
        }),
      exists: async (candidate) => {
        const found = await this.prisma.purchaseOrder.findFirst({
          where: { companyId, orderNumber: candidate },
          select: { id: true },
        });
        return !!found;
      },
    });
  }

  async nextReceiptNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "GR",
      countToday: () =>
        this.prisma.goodsReceipt.count({
          where: { companyId, createdAt: { gte: start, lt: end } },
        }),
      exists: async (candidate) => {
        const found = await this.prisma.goodsReceipt.findFirst({
          where: { companyId, receiptNumber: candidate },
          select: { id: true },
        });
        return !!found;
      },
    });
  }

  // ── Transaction log queries ─────────────────────────────────────

  findTransactionLogs(
    where: Prisma.PurchaseTransactionLogWhereInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.purchaseTransactionLog.findMany({
      where,
      select: TX_LOG_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  countTransactionLogs(where: Prisma.PurchaseTransactionLogWhereInput) {
    return this.prisma.purchaseTransactionLog.count({ where });
  }

  findBranchesByIds(companyId: string, ids: string[]) {
    return this.prisma.branch.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, name: true },
    });
  }

  findUsersByIds(ids: string[]) {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }
}
