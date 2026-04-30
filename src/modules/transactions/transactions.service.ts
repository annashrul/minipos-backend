import { Injectable } from "@nestjs/common";
import type {
  CheckoutDto,
  CheckoutResponse,
  ListTransactionsQueryDto,
  RefundTransactionResponse,
  TransactionDetailResponse,
  TransactionListResponse,
  TransactionStatsQueryDto,
  TransactionStatsResponse,
  VoidTransactionResponse,
} from "@/contracts";
import { CheckoutService } from "./internal/checkout.service";
import { TransactionQueryService } from "./internal/transaction-query.service";
import { TransactionStatusService } from "./internal/transaction-status.service";

/**
 * Facade tipis untuk Controller. Delegasi ke 3 service:
 *  - TransactionQueryService  → list / findById / stats
 *  - CheckoutService          → POS checkout (tx + stock + debt + points + realtime)
 *  - TransactionStatusService → void / refund + restore stock + audit
 *
 * Tetap dipertahankan agar API publik service tidak berubah.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly query: TransactionQueryService,
    private readonly checkoutService: CheckoutService,
    private readonly status: TransactionStatusService,
  ) {}

  list(
    companyId: string,
    query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponse> {
    return this.query.list(companyId, query);
  }

  findById(
    companyId: string,
    id: string,
  ): Promise<TransactionDetailResponse> {
    return this.query.findById(companyId, id);
  }

  stats(
    companyId: string,
    query: TransactionStatsQueryDto,
  ): Promise<TransactionStatsResponse> {
    return this.query.stats(companyId, query);
  }

  checkout(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
  ): Promise<CheckoutResponse> {
    return this.checkoutService.checkout(companyId, userId, dto);
  }

  voidTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<VoidTransactionResponse> {
    return this.status.voidTransaction(companyId, userId, id, reason);
  }

  refundTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<RefundTransactionResponse> {
    return this.status.refundTransaction(companyId, userId, id, reason);
  }
}
