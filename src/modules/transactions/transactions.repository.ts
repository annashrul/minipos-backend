import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─── SELECT constants ────────────────────────────────────────────────

export const TX_SELECT = {
  id: true,
  invoiceNumber: true,
  invoiceDisplayNumber: true,
  userId: true,
  user: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  grandTotal: true,
  paymentMethod: true,
  paymentAmount: true,
  changeAmount: true,
  status: true,
  voidReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      reference: true,
      personLabel: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransactionSelect;

export const TX_DETAIL_SELECT = {
  ...TX_SELECT,
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
      promoType: true,
      promoName: true,
      modifiers: true,
      notes: true,
    },
    orderBy: { createdAt: "asc" },
  },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      reference: true,
      personLabel: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransactionSelect;

// ─── Raw types ───────────────────────────────────────────────────────

export type RawTx = Prisma.TransactionGetPayload<{
  select: typeof TX_SELECT;
}>;
export type RawTxDetail = Prisma.TransactionGetPayload<{
  select: typeof TX_DETAIL_SELECT;
}>;

// ─── Repository ──────────────────────────────────────────────────────

@Injectable()
export class TransactionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── List & count ─────────────────────────────────────────────────

  findMany(
    where: Prisma.TransactionWhereInput,
    orderBy: Prisma.TransactionOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.transaction.findMany({
      where,
      select: TX_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  count(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.count({ where });
  }

  // ── Find by id ──────────────────────────────────────────────────

  findById(companyId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: TX_DETAIL_SELECT,
    });
  }

  findByIdMinimal(companyId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: { id: true },
    });
  }

  // ── Stats (aggregate) ──────────────────────────────────────────

  aggregateTransactions(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
  }

  // ── Checkout helpers ───────────────────────────────────────────

  findCompanySlug(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true, name: true },
    });
  }

  findBranchCode(branchId: string) {
    return this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { code: true, name: true },
    });
  }

  /**
   * Cari transaksi berdasarkan idempotencyKey (di-scope per company). Dipakai
   * checkout untuk mengembalikan transaksi yang sudah ada saat retry sinkron
   * offline, alih-alih membuat duplikat.
   */
  findByIdempotencyKey(companyId: string, idempotencyKey: string) {
    return this.prisma.transaction.findFirst({
      where: { companyId, idempotencyKey },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDisplayNumber: true,
      },
    });
  }

  findRecipesByProductIds(productIds: string[]) {
    return this.prisma.recipe.findMany({
      where: { productId: { in: productIds } },
      include: {
        ingredients: {
          include: {
            ingredient: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  findVariantsByProductIds(productIds: string[]) {
    return this.prisma.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        options: {
          select: {
            optionId: true,
            option: { select: { name: true } },
          },
        },
      },
    });
  }

  // ── Invoice display number generation ──────────────────────────

  async generateDisplayInvoiceNumber(
    companyId: string,
    date: Date,
  ): Promise<string> {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const prefix = `INV-${dd}${mm}${yyyy}-`;

    const last = await this.prisma.transaction.findFirst({
      where: {
        companyId,
        invoiceDisplayNumber: { startsWith: prefix },
      },
      orderBy: { invoiceDisplayNumber: "desc" },
      select: { invoiceDisplayNumber: true },
    });

    let nextSeq = 1;
    if (last?.invoiceDisplayNumber) {
      const tail = last.invoiceDisplayNumber.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${prefix}${String(nextSeq).padStart(5, "0")}`;
  }

  // ── Settings lookups ───────────────────────────────────────────

  findSetting(key: string, branchId: string | null) {
    return this.prisma.setting.findFirst({
      where: { key, branchId },
    });
  }

  findSettingFallback(key: string) {
    return this.prisma.setting.findFirst({
      where: { key, branchId: null },
    });
  }

  // ── Draft / duplicate lookups ──────────────────────────────────

  findDraft(companyId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: { id: true, status: true },
    });
  }

  deleteTransaction(id: string) {
    return this.prisma.transaction.delete({ where: { id } });
  }

  findForDuplicate(companyId: string, sourceId: string) {
    return this.prisma.transaction.findFirst({
      where: { id: sourceId, user: { companyId } },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            productId: true,
            productName: true,
            productCode: true,
            quantity: true,
            unitName: true,
            conversionQty: true,
            unitPrice: true,
            discount: true,
            subtotal: true,
            modifiers: true,
            notes: true,
            promoType: true,
          },
        },
        payments: {
          select: {
            method: true,
            amount: true,
            reference: true,
            personLabel: true,
          },
        },
      },
    });
  }

  // ── Replace-transaction (edit-mode) lookups ────────────────────

  findForReplace(companyId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: {
        id: true,
        status: true,
        invoiceNumber: true,
        invoiceDisplayNumber: true,
        createdAt: true,
      },
    });
  }

  // ── Customer lookup for WA receipt ─────────────────────────────

  findCustomerPhone(companyId: string, customerId: string) {
    return this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { phone: true, name: true },
    });
  }
}
