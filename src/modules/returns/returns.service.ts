import { Injectable } from "@nestjs/common";
import type {
  CreateReturnDto,
  ListReturnsQueryDto,
  RejectReturnDto,
  ReturnDetailResponse,
  ReturnListResponse,
  ReturnSummaryResponse,
  SearchExchangeProductsQueryDto,
  SearchExchangeProductsResponse,
  SearchReturnTransactionQueryDto,
  SearchReturnTransactionResponse,
} from "@/contracts";
import { ReturnCreateService } from "./internal/return-create.service";
import { ReturnLifecycleService } from "./internal/return-lifecycle.service";
import { ReturnQueryService } from "./internal/return-query.service";

/**
 * Facade tipis untuk Controller. Delegasi ke 3 service:
 *  - ReturnQueryService     → list / summary / findById / search*
 *  - ReturnCreateService    → create (validation + retry on returnNumber conflict)
 *  - ReturnLifecycleService → approve / reject / complete / delete (state transitions)
 *
 * API publik tidak berubah dari versi monolitik.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly query: ReturnQueryService,
    private readonly creator: ReturnCreateService,
    private readonly lifecycle: ReturnLifecycleService,
  ) {}

  list(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Promise<ReturnListResponse> {
    return this.query.list(companyId, query);
  }

  summary(
    companyId: string,
    query: ListReturnsQueryDto,
  ): Promise<ReturnSummaryResponse> {
    return this.query.summary(companyId, query);
  }

  findById(
    companyId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    return this.query.findById(companyId, id);
  }

  searchTransactionForReturn(
    companyId: string,
    query: SearchReturnTransactionQueryDto,
  ): Promise<SearchReturnTransactionResponse> {
    return this.query.searchTransactionForReturn(companyId, query);
  }

  searchProductsForExchange(
    companyId: string,
    query: SearchExchangeProductsQueryDto,
  ): Promise<SearchExchangeProductsResponse> {
    return this.query.searchProductsForExchange(companyId, query);
  }

  create(
    companyId: string,
    userId: string,
    dto: CreateReturnDto,
  ): Promise<ReturnDetailResponse> {
    return this.creator.create(companyId, userId, dto);
  }

  approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    return this.lifecycle.approve(companyId, userId, id);
  }

  reject(
    companyId: string,
    userId: string,
    id: string,
    dto: RejectReturnDto,
  ): Promise<ReturnDetailResponse> {
    return this.lifecycle.reject(companyId, userId, id, dto);
  }

  complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    return this.lifecycle.complete(companyId, userId, id);
  }

  delete(companyId: string, id: string): Promise<{ success: true }> {
    return this.lifecycle.delete(companyId, id);
  }
}
