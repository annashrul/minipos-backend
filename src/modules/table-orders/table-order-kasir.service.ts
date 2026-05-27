import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PaymentMethod } from "@prisma/client";
import type {
  PayCashierDto,
  StartOnlinePaymentDto,
  TableOrderResponse,
  TablePaymentResponse,
  TableSessionResponse,
} from "./dto/table-orders.dto";
import { ORDER_SELECT, SESSION_SELECT, TableOrdersRepository } from "./table-orders.repository";
import {
  findTableByToken,
  toOrderResponse,
  toSessionResponse,
  nextQueueNumber,
  nextInvoiceNumber,
  nextInvoiceDisplayNumber,
} from "./table-orders.helpers";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";

@Injectable()
export class TableOrderKasirService {
  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async approve(
    companyId: string,
    userId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    const order = await this.findOrderForCompany(companyId, orderId);
    if (order.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Order tidak dalam status menunggu approval",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Create kitchen queue entry
      const queueNumber = await nextQueueNumber(tx, order.branchId);
      const queue = await tx.orderQueue.create({
        data: {
          queueNumber,
          branchId: order.branchId,
          tableId: order.tableId,
          status: "NEW",
          notes: order.customerNote ?? null,
          items: {
            create: order.items.map((i) => ({
              productName: i.productName,
              quantity: i.qty,
              notes: i.note ?? null,
              status: "PENDING",
            })),
          },
        },
        select: { id: true, queueNumber: true },
      });

      const u = await tx.tableOrder.update({
        where: { id: order.id },
        data: {
          status: "SENT_TO_KITCHEN",
          approvedBy: userId,
          approvedAt: new Date(),
          orderQueueId: queue.id,
        },
        select: ORDER_SELECT,
      });
      return { order: u, queue };
    });

    const resp = toOrderResponse(updated.order);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_APPROVED,
      {
        orderId: resp.id,
        sessionId: resp.sessionId,
        tableId: resp.tableId,
        queueId: updated.queue.id,
        queueNumber: updated.queue.queueNumber,
      },
      order.branchId,
    );
    // Also fire ORDER_QUEUE_CREATED so KDS picks it up
    this.realtime.emit(
      EVENTS.ORDER_QUEUE_CREATED,
      {
        queueId: updated.queue.id,
        queueNumber: updated.queue.queueNumber,
        fromTableOrder: true,
      },
      order.branchId,
    );
    return resp;
  }

  async reject(
    companyId: string,
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<TableOrderResponse> {
    const order = await this.findOrderForCompany(companyId, orderId);
    if (order.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Order tidak dalam status menunggu approval",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.tableOrder.update({
        where: { id: order.id },
        data: {
          status: "REJECTED",
          rejectReason: reason,
          approvedBy: userId,
          approvedAt: new Date(),
        },
        select: ORDER_SELECT,
      });
      // Subtract from session subtotal
      await tx.tableSession.update({
        where: { id: order.sessionId },
        data: { subtotal: { decrement: order.total } },
      });
      return u;
    });

    const resp = toOrderResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_REJECTED,
      {
        orderId: resp.id,
        sessionId: resp.sessionId,
        tableId: resp.tableId,
        reason,
      },
      order.branchId,
    );
    return resp;
  }

  async markOrderReady(
    companyId: string,
    orderId: string,
  ): Promise<TableOrderResponse> {
    const order = await this.findOrderForCompany(companyId, orderId);
    const updated = await this.repo.updateOrder(order.id, { status: "READY" });
    const resp = toOrderResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_READY,
      { orderId: resp.id, sessionId: resp.sessionId, tableId: resp.tableId },
      order.branchId,
    );
    return resp;
  }

  /**
   * Cashier finalises payment: create POS Transaction + close session.
   * Lightweight version that snapshots current session items.
   */
  async payByCashier(
    companyId: string,
    userId: string,
    sessionId: string,
    dto: PayCashierDto,
  ): Promise<TableSessionResponse> {
    const session = await this.findSessionForCompany(companyId, sessionId);
    if (session.status === "CLOSED") {
      throw new BadRequestException("Sesi sudah ditutup");
    }
    const approvedOrders = session.orders.filter(
      (o) =>
        o.status === "APPROVED" ||
        o.status === "SENT_TO_KITCHEN" ||
        o.status === "READY" ||
        o.status === "SERVED",
    );
    if (approvedOrders.length === 0) {
      throw new BadRequestException("Belum ada order yang disetujui");
    }

    const grandTotal = approvedOrders.reduce((s, o) => s + o.total, 0);
    if (dto.paymentAmount < grandTotal) {
      throw new BadRequestException("Pembayaran kurang dari total tagihan");
    }

    const invoiceNumber = await nextInvoiceNumber(
      this.repo,
      session.branchId,
    );
    const invoiceDisplayNumber = await nextInvoiceDisplayNumber(
      this.repo,
      companyId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const trx = await tx.transaction.create({
        data: {
          invoiceNumber,
          invoiceDisplayNumber,
          companyId,
          userId,
          branchId: session.branchId,
          subtotal: grandTotal,
          discountAmount: 0,
          taxAmount: 0,
          grandTotal,
          paymentMethod: dto.paymentMethod as PaymentMethod,
          paymentAmount: dto.paymentAmount,
          changeAmount: Math.max(0, dto.paymentAmount - grandTotal),
          status: "COMPLETED",
          notes: dto.notes ?? null,
          tableId: session.tableId,
          items: {
            create: approvedOrders.flatMap((o) =>
              o.items.map((i) => ({
                productId: i.productId,
                productName: i.productName,
                productCode: "",
                quantity: i.qty,
                unitPrice: i.unitPrice,
                subtotal: i.subtotal,
              })),
            ),
          },
        },
        select: { id: true },
      });

      const closed = await tx.tableSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          paidAmount: dto.paymentAmount,
          transactionId: trx.id,
          closedAt: new Date(),
        },
        select: SESSION_SELECT,
      });

      // Mark all approved orders as SERVED
      await tx.tableOrder.updateMany({
        where: {
          sessionId: session.id,
          status: { in: ["APPROVED", "SENT_TO_KITCHEN", "READY"] },
        },
        data: { status: "SERVED" },
      });

      // Free the table
      await tx.restaurantTable.update({
        where: { id: session.tableId },
        data: { status: "AVAILABLE" },
      });

      return closed;
    });

    const resp = toSessionResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_SESSION_CLOSED,
      {
        sessionId: resp.id,
        tableId: resp.tableId,
        transactionId: resp.transactionId,
      },
      session.branchId,
    );
    return resp;
  }

  /** Manual close (customer left without paying / void). */
  async forceCloseSession(
    companyId: string,
    sessionId: string,
  ): Promise<TableSessionResponse> {
    const session = await this.findSessionForCompany(companyId, sessionId);
    if (session.status === "CLOSED") return toSessionResponse(session);

    const closed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tableSession.update({
        where: { id: session.id },
        data: { status: "CLOSED", closedAt: new Date() },
        select: SESSION_SELECT,
      });
      await tx.restaurantTable.update({
        where: { id: session.tableId },
        data: { status: "AVAILABLE" },
      });
      return updated;
    });

    this.realtime.emit(
      EVENTS.TABLE_SESSION_CLOSED,
      { sessionId: closed.id, tableId: closed.tableId },
      session.branchId,
    );
    return toSessionResponse(closed);
  }

  /**
   * Link an existing POS Transaction to a TableSession + close the session.
   */
  async linkTransactionAndClose(
    companyId: string,
    sessionId: string,
    transactionId: string,
  ): Promise<TableSessionResponse> {
    const session = await this.findSessionForCompany(companyId, sessionId);
    if (session.status === "CLOSED") {
      throw new BadRequestException("Sesi sudah ditutup");
    }
    // Verify transaction belongs to same company
    const trx = await this.repo.findTransactionForCompany(companyId, transactionId);
    if (!trx) throw new NotFoundException("Transaksi tidak ditemukan");

    const closed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tableSession.update({
        where: { id: session.id },
        data: {
          status: "CLOSED",
          transactionId: trx.id,
          closedAt: new Date(),
          paidAmount: session.subtotal,
        },
        select: SESSION_SELECT,
      });
      await tx.tableOrder.updateMany({
        where: {
          sessionId: session.id,
          status: { in: ["APPROVED", "SENT_TO_KITCHEN", "READY"] },
        },
        data: { status: "SERVED" },
      });
      await tx.restaurantTable.update({
        where: { id: session.tableId },
        data: { status: "AVAILABLE" },
      });
      return updated;
    });

    this.realtime.emit(
      EVENTS.TABLE_SESSION_CLOSED,
      { sessionId: closed.id, tableId: closed.tableId, transactionId: trx.id },
      session.branchId,
    );
    return toSessionResponse(closed);
  }

  // ────────────────────────────────────────────────────────────
  // PAYMENT FOUNDATION (online -- provider-agnostic)
  // ────────────────────────────────────────────────────────────
  async startOnlinePayment(
    qrToken: string,
    sessionId: string,
    dto: StartOnlinePaymentDto,
  ): Promise<TablePaymentResponse> {
    const table = await findTableByToken(this.repo, qrToken);
    const session = await this.repo.findSessionForPayment(sessionId, table.id);
    if (!session) throw new NotFoundException("Sesi tidak ditemukan");
    if (session.status === "CLOSED") {
      throw new BadRequestException("Sesi sudah ditutup");
    }
    if (session.subtotal <= 0) {
      throw new BadRequestException("Belum ada order yang bisa dibayar");
    }

    const payment = await this.repo.createPayment({
      sessionId: session.id,
      provider: dto.provider,
      channel: dto.channel ?? null,
      amount: session.subtotal,
      status: "PENDING",
    });

    await this.repo.updateSessionStatus(session.id, "AWAITING_PAYMENT");

    this.realtime.emit(
      EVENTS.TABLE_PAYMENT_UPDATED,
      { paymentId: payment.id, sessionId: session.id, status: "PENDING" },
      session.branchId,
    );

    return {
      id: payment.id,
      sessionId: payment.sessionId,
      provider: payment.provider,
      channel: payment.channel,
      amount: payment.amount,
      status: payment.status,
      externalId: payment.externalId,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────
  private async findOrderForCompany(companyId: string, orderId: string) {
    const order = await this.repo.findOrderForCompany(companyId, orderId);
    if (!order) throw new NotFoundException("Order tidak ditemukan");
    return order;
  }

  private async findSessionForCompany(companyId: string, sessionId: string) {
    const session = await this.repo.findSessionForCompany(companyId, sessionId);
    if (!session) throw new NotFoundException("Sesi tidak ditemukan");
    return session;
  }
}
