import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CheckoutDto,
  CheckoutResponse,
  ListTransactionsQueryDto,
  RefundTransactionResponse,
  TransactionDetailResponse,
  TransactionListResponse,
  TransactionResponse,
  TransactionStatsQueryDto,
  TransactionStatsResponse,
  VoidTransactionResponse,
} from "./dto/transactions.dto";
import { paginate } from "@/common/utils/pagination";
import {
  TransactionsRepository,
  type RawTx,
  type RawTxDetail,
} from "./transactions.repository";
import { TransactionCheckoutService } from "./transaction-checkout.service";
import { TransactionVoidRefundService } from "./transaction-void-refund.service";

@Injectable()
export class TransactionsService implements OnModuleInit {
  constructor(
    private readonly repo: TransactionsRepository,
    private readonly checkoutService: TransactionCheckoutService,
    private readonly voidRefundService: TransactionVoidRefundService,
  ) {}

  /**
   * Wire the void function into the checkout service so edit-mode
   * (replaceTransactionId) can void the source transaction without
   * creating a circular dependency between the two sub-services.
   */
  onModuleInit() {
    this.checkoutService.setVoidFn(
      (companyId, userId, id, reason) =>
        this.voidRefundService.voidTransaction(companyId, userId, id, reason),
    );
  }

  // ─── List / Detail / Stats ────────────────────────────────────────

  async list(
    companyId: string,
    query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponse> {
    const {
      search,
      status,
      paymentMethod,
      branchId,
      userId,
      customerId,
      from,
      to,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;

    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
    };
    if (search) {
      where.invoiceNumber = { contains: search, mode: "insensitive" };
    }
    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (branchId) where.branchId = branchId;
    if (userId) where.userId = userId;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // OrderBy dinamis dengan whitelist + default fallback createdAt desc.
    const dir: "asc" | "desc" = sortDir ?? "desc";
    let orderBy: Prisma.TransactionOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "user":
          orderBy = { user: { name: dir } };
          break;
        case "invoiceNumber":
        case "createdAt":
        case "grandTotal":
        case "paymentMethod":
        case "status":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.TransactionOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toTransactionResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<TransactionDetailResponse> {
    const tx = await this.repo.findById(companyId, id);
    if (!tx) throw new NotFoundException("Transaksi tidak ditemukan");
    return toTransactionDetailResponse(tx);
  }

  async stats(
    companyId: string,
    query: TransactionStatsQueryDto,
  ): Promise<TransactionStatsResponse> {
    const { branchId, from, to } = query;
    const baseWhere: Prisma.TransactionWhereInput = { user: { companyId } };
    if (branchId) baseWhere.branchId = branchId;
    if (from || to) {
      baseWhere.createdAt = {};
      if (from) baseWhere.createdAt.gte = new Date(from);
      if (to) baseWhere.createdAt.lte = new Date(to);
    }

    const completedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "COMPLETED",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "VOIDED",
    };

    const [completedAgg, refundedAgg, voidedAgg] = await Promise.all([
      this.repo.aggregateTransactions(completedWhere),
      this.repo.aggregateTransactions(refundedWhere),
      this.repo.aggregateTransactions(voidedWhere),
    ]);

    const totalSales = completedAgg._sum.grandTotal ?? 0;
    const transactionCount = completedAgg._count._all;
    const avgTransaction =
      transactionCount > 0 ? totalSales / transactionCount : 0;
    const totalRefund = refundedAgg._count._all;
    const totalVoid = voidedAgg._count._all;

    return {
      totalSales,
      transactionCount,
      avgTransaction,
      totalRefund,
      totalVoid,
    };
  }

  // ─── Draft ────────────────────────────────────────────────────────

  async deleteDraft(companyId: string, id: string): Promise<{ id: string }> {
    const tx = await this.repo.findDraft(companyId, id);
    if (!tx) throw new NotFoundException("Draft tidak ditemukan");
    if (tx.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya draft yang bisa dihapus. Pakai void/refund untuk transaksi selesai.",
      );
    }
    await this.repo.deleteTransaction(id);
    return { id };
  }

  // ─── Delegated to CheckoutService ─────────────────────────────────

  checkout(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
  ): Promise<CheckoutResponse> {
    return this.checkoutService.checkout(companyId, userId, dto);
  }

  createDraft(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
  ): Promise<{
    id: string;
    invoiceNumber: string;
    invoiceDisplayNumber: string | null;
  }> {
    return this.checkoutService.createDraft(companyId, userId, dto);
  }

  duplicate(
    companyId: string,
    userId: string,
    sourceId: string,
  ): Promise<CheckoutResponse> {
    return this.checkoutService.duplicate(companyId, userId, sourceId);
  }

  // ─── Delegated to VoidRefundService ───────────────────────────────

  voidTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<VoidTransactionResponse> {
    return this.voidRefundService.voidTransaction(
      companyId,
      userId,
      id,
      reason,
    );
  }

  refundTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<RefundTransactionResponse> {
    return this.voidRefundService.refundTransaction(
      companyId,
      userId,
      id,
      reason,
    );
  }
}

// ─── Response mappers (used by list / findById) ─────────────────────

function toTransactionResponse(t: RawTx): TransactionResponse {
  return {
    id: t.id,
    invoiceNumber: t.invoiceNumber,
    invoiceDisplayNumber: t.invoiceDisplayNumber ?? null,
    userId: t.userId,
    user: t.user ? { id: t.user.id, name: t.user.name } : null,
    branchId: t.branchId,
    branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
    customerId: t.customerId,
    customer: t.customer ? { id: t.customer.id, name: t.customer.name, phone: t.customer.phone } : null,
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxAmount: t.taxAmount,
    grandTotal: t.grandTotal,
    paymentMethod: t.paymentMethod,
    paymentAmount: t.paymentAmount,
    changeAmount: t.changeAmount,
    status: t.status,
    voidReason: t.voidReason,
    notes: t.notes,
    syncedFromOffline: t.syncedFromOffline,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    itemCount: t._count.items,
    payments: t.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      personLabel: p.personLabel,
    })),
  };
}

function toTransactionDetailResponse(
  t: RawTxDetail,
): TransactionDetailResponse {
  return {
    ...toTransactionResponse(t),
    items: t.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: i.unitPrice,
      discount: i.discount,
      subtotal: i.subtotal,
      promoType: i.promoType,
      promoName: i.promoName,
      // modifiers JSON di DB: array {groupId, groupName, optionId, optionName, priceAdjustment}.
      // Cast as known shape buat display di FE riwayat.
      modifiers: (i.modifiers as Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceAdjustment: number;
      }> | null) ?? null,
      notes: i.notes ?? null,
    })),
    payments: t.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      personLabel: p.personLabel,
    })),
  };
}
