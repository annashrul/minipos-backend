import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
} from "./dto/table-orders.dto";
import { paginate } from "@/common/utils/pagination";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RealtimeService } from "@/modules/realtime/realtime.service";
import { TableOrdersRepository } from "./table-orders.repository";
import { TablePublicService } from "./table-public.service";
import { TableOrderKasirService } from "./table-order-kasir.service";
import { TableOrderSubmitService } from "./table-order-submit.service";
import {
  cleanupStaleSessions,
  toOrderResponse,
  toSessionResponse,
} from "./table-orders.helpers";

@Injectable()
export class TableOrdersService {
  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly publicService: TablePublicService,
    private readonly kasirService: TableOrderKasirService,
    private readonly submitService: TableOrderSubmitService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // PUBLIC (tablet) — delegated to TablePublicService
  // ────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────
  // SUBMIT — delegated to TableOrderSubmitService
  // ────────────────────────────────────────────────────────────
  submitOrder(
    qrToken: string,
    dto: SubmitTableOrderDto,
  ): Promise<TableOrderResponse> {
    return this.submitService.submitOrder(qrToken, dto);
  }

  // ────────────────────────────────────────────────────────────
  // KASIR (authenticated) — list kept here, rest delegated
  // ────────────────────────────────────────────────────────────
  async listOrders(
    companyId: string,
    query: ListTableOrdersQueryDto,
  ): Promise<TableOrderListResponse> {
    await cleanupStaleSessions(
      this.repo,
      this.prisma,
      this.realtime,
      companyId,
      query.branchId,
    );
    const where: Prisma.TableOrderWhereInput = {
      branch: { companyId },
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.tableId) where.tableId = query.tableId;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    const [rows, total] = await Promise.all([
      this.repo.findOrdersFull(where, (query.page - 1) * query.perPage, query.perPage),
      this.repo.countOrders(where),
    ]);
    return paginate(rows.map(toOrderResponse), total, query.page, query.perPage);
  }

  async listSessions(
    companyId: string,
    query: ListTableSessionsQueryDto,
  ): Promise<TableSessionListResponse> {
    await cleanupStaleSessions(
      this.repo,
      this.prisma,
      this.realtime,
      companyId,
      query.branchId,
    );
    const where: Prisma.TableSessionWhereInput = {
      branch: { companyId },
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.tableId) where.tableId = query.tableId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.repo.findSessionsFull(where, (query.page - 1) * query.perPage, query.perPage),
      this.repo.countSessions(where),
    ]);
    return paginate(rows.map(toSessionResponse), total, query.page, query.perPage);
  }

  approve(
    companyId: string,
    userId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    return this.kasirService.approve(companyId, userId, orderId);
  }

  reject(
    companyId: string,
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<TableOrderResponse> {
    return this.kasirService.reject(companyId, userId, orderId, reason);
  }

  markOrderReady(
    companyId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    return this.kasirService.markOrderReady(companyId, orderId);
  }

  payByCashier(
    companyId: string,
    userId: string,
    sessionId: string,
    dto: PayCashierDto,
  ): Promise<TableSessionResponse> {
    return this.kasirService.payByCashier(companyId, userId, sessionId, dto);
  }

  forceCloseSession(
    companyId: string,
    sessionId: string,
  ): Promise<TableSessionResponse> {
    return this.kasirService.forceCloseSession(companyId, sessionId);
  }

  linkTransactionAndClose(
    companyId: string,
    sessionId: string,
    transactionId: string,
  ): Promise<TableSessionResponse> {
    return this.kasirService.linkTransactionAndClose(
      companyId,
      sessionId,
      transactionId,
    );
  }

  startOnlinePayment(
    qrToken: string,
    sessionId: string,
    dto: StartOnlinePaymentDto,
  ): Promise<TablePaymentResponse> {
    return this.kasirService.startOnlinePayment(qrToken, sessionId, dto);
  }
}
