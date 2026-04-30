import { Injectable } from "@nestjs/common";
import type {
  ListTableOrdersQueryDto,
  ListTableSessionsQueryDto,
  PayCashierDto,
  PublicCatalogResponse,
  PublicProductDetailResponse,
  PublicProductsPageResponse,
  PublicProductsQueryDto,
  PublicTableInfoResponseDto,
  StartOnlinePaymentDto,
  SubmitTableOrderDto,
  TableOrderListResponse,
  TableOrderResponse,
  TablePaymentResponse,
  TableSessionListResponse,
  TableSessionResponse,
} from "@/contracts";
import { PublicTableService } from "./internal/public-table.service";
import { TableOrderManagementService } from "./internal/table-order-management.service";
import { TableOrderSubmitService } from "./internal/table-order-submit.service";
import { TableSessionService } from "./internal/table-session.service";

/**
 * Facade tipis. Delegasi:
 *  - PublicTableService           → endpoint publik via qrToken (info/catalog/products/session)
 *  - TableOrderSubmitService      → submit order + start online payment
 *  - TableOrderManagementService  → list/approve/reject/markReady (kasir)
 *  - TableSessionService          → list session + payByCashier/forceClose/linkTransactionAndClose
 */
@Injectable()
export class TableOrdersService {
  constructor(
    private readonly publicService: PublicTableService,
    private readonly submit: TableOrderSubmitService,
    private readonly management: TableOrderManagementService,
    private readonly sessions: TableSessionService,
  ) {}

  // Public
  getPublicTableInfo(qrToken: string): Promise<PublicTableInfoResponseDto> {
    return this.publicService.getPublicTableInfo(qrToken);
  }
  getPublicCatalog(qrToken: string): Promise<PublicCatalogResponse> {
    return this.publicService.getPublicCatalog(qrToken);
  }
  getPublicProducts(
    qrToken: string,
    query: PublicProductsQueryDto,
  ): Promise<PublicProductsPageResponse> {
    return this.publicService.getPublicProducts(qrToken, query);
  }
  getPublicProductDetail(
    qrToken: string,
    productId: string,
  ): Promise<PublicProductDetailResponse> {
    return this.publicService.getPublicProductDetail(qrToken, productId);
  }
  getPublicActiveSession(
    qrToken: string,
  ): Promise<TableSessionResponse | null> {
    return this.publicService.getPublicActiveSession(qrToken);
  }

  // Submit
  submitOrder(
    qrToken: string,
    dto: SubmitTableOrderDto,
  ): Promise<TableOrderResponse> {
    return this.submit.submitOrder(qrToken, dto);
  }
  startOnlinePayment(
    qrToken: string,
    sessionId: string,
    dto: StartOnlinePaymentDto,
  ): Promise<TablePaymentResponse> {
    return this.submit.startOnlinePayment(qrToken, sessionId, dto);
  }

  // Management (kasir)
  listOrders(
    companyId: string,
    query: ListTableOrdersQueryDto,
  ): Promise<TableOrderListResponse> {
    return this.management.listOrders(companyId, query);
  }
  approve(
    companyId: string,
    userId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    return this.management.approve(companyId, userId, orderId);
  }
  reject(
    companyId: string,
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<TableOrderResponse> {
    return this.management.reject(companyId, userId, orderId, reason);
  }
  markOrderReady(
    companyId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    return this.management.markOrderReady(companyId, orderId);
  }

  // Sessions (kasir)
  listSessions(
    companyId: string,
    query: ListTableSessionsQueryDto,
  ): Promise<TableSessionListResponse> {
    return this.sessions.listSessions(companyId, query);
  }
  payByCashier(
    companyId: string,
    userId: string,
    sessionId: string,
    dto: PayCashierDto,
  ): Promise<TableSessionResponse> {
    return this.sessions.payByCashier(companyId, userId, sessionId, dto);
  }
  forceCloseSession(
    companyId: string,
    sessionId: string,
  ): Promise<TableSessionResponse> {
    return this.sessions.forceCloseSession(companyId, sessionId);
  }
  linkTransactionAndClose(
    companyId: string,
    sessionId: string,
    transactionId: string,
  ): Promise<TableSessionResponse> {
    return this.sessions.linkTransactionAndClose(
      companyId,
      sessionId,
      transactionId,
    );
  }
}
