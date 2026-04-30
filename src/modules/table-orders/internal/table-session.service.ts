import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PaymentMethod } from "@prisma/client";
import type {
  ListTableSessionsQueryDto,
  PayCashierDto,
  TableSessionListResponse,
  TableSessionResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import {
  findSessionForCompany,
  nextInvoiceNumber,
} from "./table-orders.helpers";
import { toSessionResponse } from "./table-orders.mapper";
import { SESSION_SELECT } from "./table-orders.select";

@Injectable()
export class TableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listSessions(
    companyId: string,
    query: ListTableSessionsQueryDto,
  ): Promise<TableSessionListResponse> {
    const where: Prisma.TableSessionWhereInput = {
      branch: { companyId },
    };
    if (query.branchId) where.branchId = query.branchId;
    if (query.tableId) where.tableId = query.tableId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.tableSession.findMany({
        where,
        select: SESSION_SELECT,
        orderBy: { openedAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.tableSession.count({ where }),
    ]);
    return {
      sessions: rows.map(toSessionResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async payByCashier(
    companyId: string,
    userId: string,
    sessionId: string,
    dto: PayCashierDto,
  ): Promise<TableSessionResponse> {
    const session = await findSessionForCompany(this.prisma, companyId, sessionId);
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

    const invoiceNumber = await nextInvoiceNumber(this.prisma, session.branchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const trx = await tx.transaction.create({
        data: {
          invoiceNumber,
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

      await tx.tableOrder.updateMany({
        where: { sessionId: session.id, status: { in: ["APPROVED", "SENT_TO_KITCHEN", "READY"] } },
        data: { status: "SERVED" },
      });

      await tx.restaurantTable.update({
        where: { id: session.tableId },
        data: { status: "AVAILABLE" },
      });

      return closed;
    });

    const resp = toSessionResponse(updated);
    this.realtime.emit(
      EVENTS.TABLE_SESSION_CLOSED,
      { sessionId: resp.id, tableId: resp.tableId, transactionId: resp.transactionId },
      session.branchId,
    );
    return resp;
  }

  async forceCloseSession(
    companyId: string,
    sessionId: string,
  ): Promise<TableSessionResponse> {
    const session = await findSessionForCompany(this.prisma, companyId, sessionId);
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

  async linkTransactionAndClose(
    companyId: string,
    sessionId: string,
    transactionId: string,
  ): Promise<TableSessionResponse> {
    const session = await findSessionForCompany(this.prisma, companyId, sessionId);
    if (session.status === "CLOSED") {
      throw new BadRequestException("Sesi sudah ditutup");
    }
    const trx = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user: { companyId } },
      select: { id: true },
    });
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
}
