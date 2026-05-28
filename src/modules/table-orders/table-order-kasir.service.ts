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

    // Tentukan order mana yang akan dibayar — bisa subset (dari dto.orderIds)
    // atau semua unpaid (default). Order yang sudah dibayar di payment
    // sebelumnya di-exclude.
    const pendingOrders = await this.prisma.tableOrder.findMany({
      where: { sessionId: session.id, status: "PENDING_APPROVAL" },
      select: { id: true, total: true },
    });
    const paidPaymentsBefore = await this.prisma.tableSessionPayment.findMany({
      where: { sessionId: session.id, status: "PAID" },
      select: { rawPayload: true },
    });
    const previouslyCovered = new Set<string>();
    for (const p of paidPaymentsBefore) {
      const raw = p.rawPayload as Record<string, unknown> | null;
      const ids = raw?.["coveredOrderIds"];
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") previouslyCovered.add(id);
      }
    }
    const unpaidOrders = pendingOrders.filter((o) => !previouslyCovered.has(o.id));

    let targetOrders: { id: string; total: number }[];
    if (dto.orderIds && dto.orderIds.length > 0) {
      const requestedSet = new Set(dto.orderIds);
      targetOrders = unpaidOrders.filter((o) => requestedSet.has(o.id));
      if (targetOrders.length === 0) {
        throw new BadRequestException("Order tidak valid atau sudah dibayar");
      }
      if (targetOrders.length !== dto.orderIds.length) {
        throw new BadRequestException(
          "Beberapa order tidak ditemukan atau sudah dibayar",
        );
      }
    } else {
      targetOrders = unpaidOrders;
    }
    if (targetOrders.length === 0) {
      throw new BadRequestException("Tidak ada tagihan yang perlu dibayar");
    }

    const chargeAmount = targetOrders.reduce((s, o) => s + o.total, 0);
    if (chargeAmount <= 0) {
      throw new BadRequestException("Tagihan kosong");
    }
    const targetOrderIds = targetOrders.map((o) => o.id);
    // Default merge=true (1 Transaction utk semua order yang dicover). Hanya
    // false kalau customer eksplisit minta pisah (split bill multi-order).
    const mergeTransactions = dto.mergeTransactions !== false;

    // ─── MOCK XENDIT — generate fake gateway response per channel ──────
    // TODO(xendit-integration): ganti block ini dengan panggilan ke Xendit
    // SDK saat integrasi beneran sudah selesai.
    const mock = buildMockGatewayPayload(dto, chargeAmount);

    const payment = await this.repo.createPayment({
      sessionId: session.id,
      provider: dto.provider,
      channel: dto.channel ?? null,
      amount: chargeAmount,
      status: "PENDING",
      externalId: mock.externalId,
      rawPayload: {
        ...mock.rawPayload,
        targetOrderIds,
        mergeTransactions,
      } as unknown as Prisma.InputJsonValue,
    });

    // NOTE: Sebelumnya session di-set ke AWAITING_PAYMENT di sini, tapi flow
    // baru = multi-checkout per sesi (customer boleh tambah order setelah
    // bayar batch 1). Biarkan status tetap OPEN supaya `submitOrder`
    // berikutnya tidak diblok.

    this.realtime.emit(
      EVENTS.TABLE_PAYMENT_UPDATED,
      { paymentId: payment.id, sessionId: session.id, status: "PENDING" },
      session.branchId,
    );

    // Auto-sukses: simulasikan customer bayar 8 detik kemudian + emit
    // socket event yang sama dengan flow webhook Xendit beneran.
    this.scheduleMockPaymentSuccess({
      paymentId: payment.id,
      sessionId: session.id,
      tableId: session.tableId,
      branchId: session.branchId,
      amount: chargeAmount,
    });

    return {
      id: payment.id,
      sessionId: payment.sessionId,
      provider: payment.provider,
      channel: payment.channel,
      amount: payment.amount,
      status: payment.status,
      externalId: mock.externalId,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
      createdAt: payment.createdAt.toISOString(),
      qrString: mock.qrString,
      paymentUrl: mock.paymentUrl,
      expiresAt: mock.expiresAt,
      actions: mock.actions,
      bankCode: mock.bankCode,
      accountNumber: mock.accountNumber,
      vaName: mock.vaName,
    };
  }

  /**
   * Schedule fake payment success — 8 detik setelah charge dibuat,
   * payment di-mark PAID, session ditutup, dan event socket dipancarkan
   * mirip dengan webhook callback dari Xendit. Fire-and-forget; error
   * di-log tapi tidak mempengaruhi response request awal.
   */
  private scheduleMockPaymentSuccess(params: {
    paymentId: string;
    sessionId: string;
    tableId: string;
    branchId: string;
    amount: number;
  }): void {
    const { paymentId, sessionId, tableId, branchId, amount } = params;
    setTimeout(() => {
      void this.markMockPaymentPaid({ paymentId, sessionId, tableId, branchId, amount }).catch(
        (err) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[mock-payment] gagal auto-paid ${paymentId}:`,
            err instanceof Error ? err.message : err,
          );
        },
      );
    }, 8000);
  }

  private async markMockPaymentPaid(params: {
    paymentId: string;
    sessionId: string;
    tableId: string;
    branchId: string;
    amount: number;
  }): Promise<void> {
    const { paymentId, sessionId, tableId, branchId, amount } = params;
    const paidAt = new Date();

    // Ambil meta yang dibutuhkan untuk buat Transaction POS:
    // - company dari branch
    // - user untuk di-attribute (prioritas OWNER → ADMIN → CASHIER → siapapun)
    // - channel dari TableSessionPayment (untuk mapping PaymentMethod)
    // - PENDING_APPROVAL orders yang BELUM di-cover payment sebelumnya
    const [branch, payment, paidPayments] = await Promise.all([
      this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { companyId: true },
      }),
      this.prisma.tableSessionPayment.findUnique({
        where: { id: paymentId },
        select: { channel: true, rawPayload: true, provider: true },
      }),
      this.prisma.tableSessionPayment.findMany({
        where: { sessionId, status: "PAID" },
        select: { rawPayload: true },
      }),
    ]);
    if (!branch || !branch.companyId) {
      console.warn(`[mock-payment] branch ${branchId} tidak punya companyId`);
      return;
    }
    const companyId = branch.companyId;

    // User attribution — prefer OWNER/ADMIN di branch, fallback ke any user
    // di branch, fallback lagi ke any user di company.
    const userForTx =
      (await this.prisma.user.findFirst({
        where: { branchId, role: { in: ["OWNER", "ADMIN"] } },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: { branchId },
        select: { id: true },
      })) ??
      (await this.prisma.user.findFirst({
        where: { companyId },
        select: { id: true },
      }));

    // Ambil targetOrderIds & merge flag dari rawPayload (di-set di
    // startOnlinePayment). Targetnya selalu eksplisit — kalau dto.orderIds
    // tidak dikirim, startOnlinePayment fill dengan semua unpaid.
    const rawAtStart = payment?.rawPayload as Record<string, unknown> | null;
    const targetOrderIds = Array.isArray(rawAtStart?.["targetOrderIds"])
      ? (rawAtStart!["targetOrderIds"] as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    const mergeTransactions =
      typeof rawAtStart?.["mergeTransactions"] === "boolean"
        ? (rawAtStart!["mergeTransactions"] as boolean)
        : true;

    // Filter orders yang sudah di-cover payment sebelumnya — disimpan di
    // payment.rawPayload.coveredOrderIds saat payment PAID dibuat.
    const alreadyCovered = new Set<string>();
    for (const p of paidPayments) {
      const raw = p.rawPayload as Record<string, unknown> | null;
      const ids = raw?.["coveredOrderIds"];
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") alreadyCovered.add(id);
      }
    }
    // Pakai targetOrderIds dari startOnlinePayment kalau ada, kalau tidak
    // fallback ke semua pending yang belum di-cover (backward compat).
    const orderFilter: Prisma.TableOrderWhereInput = {
      sessionId,
      status: "PENDING_APPROVAL",
      ...(targetOrderIds.length > 0
        ? { id: { in: targetOrderIds } }
        : alreadyCovered.size > 0
          ? { id: { notIn: Array.from(alreadyCovered) } }
          : {}),
    };
    const orders = await this.prisma.tableOrder.findMany({
      where: orderFilter,
      select: {
        id: true,
        total: true,
        items: {
          select: {
            productId: true,
            productName: true,
            qty: true,
            unitPrice: true,
            subtotal: true,
          },
        },
      },
    });

    // Map channel → PaymentMethod enum. Channel bisa "QRIS",
    // "EWALLET:ID_OVO", "TRANSFER", dll.
    const channel = (payment?.channel ?? "").toUpperCase();
    const paymentMethod: PaymentMethod =
      channel === "QRIS"
        ? "QRIS"
        : channel === "TRANSFER"
          ? "TRANSFER"
          : channel === "EWALLET" || channel.startsWith("EWALLET")
            ? "EWALLET"
            : "QRIS";

    // Bangun "batches" — per-batch akan jadi 1 Transaction record.
    // merge=true → 1 batch berisi semua orders.
    // merge=false → N batches, satu per order (split bill).
    type Batch = {
      orders: typeof orders;
      amount: number;
    };
    const batches: Batch[] =
      mergeTransactions || orders.length <= 1
        ? [{ orders, amount: orders.reduce((s, o) => s + o.total, 0) }]
        : orders.map((o) => ({ orders: [o], amount: o.total }));

    // Pre-generate invoice numbers untuk semua batch — sequence count
    // dilakukan SEKALI di luar tx, lalu di-offset per-batch supaya tidak
    // konflik dengan nextInvoiceNumber (yang query countTransactionsToday).
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = String(today.getFullYear());
    const displayPrefix = `INV-${dd}${mm}${yyyy}-`;

    let invoiceData: { invoiceNumber: string; invoiceDisplayNumber: string }[] = [];
    if (userForTx && batches.length > 0 && orders.length > 0) {
      const baseCount = await this.repo.countTransactionsToday(branchId, startOfDay);
      const lastDisplay = await this.repo.findLastInvoiceDisplayNumber(
        companyId,
        displayPrefix,
      );
      let lastDisplaySeq = 0;
      if (lastDisplay?.invoiceDisplayNumber) {
        const tail = lastDisplay.invoiceDisplayNumber.slice(displayPrefix.length);
        const parsed = parseInt(tail, 10);
        if (!Number.isNaN(parsed)) lastDisplaySeq = parsed;
      }
      invoiceData = batches.map((_, i) => ({
        invoiceNumber: `INV-${ymd}-${String(baseCount + i + 1).padStart(4, "0")}`,
        invoiceDisplayNumber: `${displayPrefix}${String(lastDisplaySeq + i + 1).padStart(5, "0")}`,
      }));
    }

    let createdTransactionIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      // Skip kalau sudah dibayar / di-cancel di antara request awal & sini.
      const current = await tx.tableSessionPayment.findUnique({
        where: { id: paymentId },
        select: { status: true, rawPayload: true },
      });
      if (!current || current.status !== "PENDING") return;

      // 1. Buat Transaction POS per batch
      if (userForTx && invoiceData.length === batches.length && orders.length > 0) {
        for (let i = 0; i < batches.length; i += 1) {
          const batch = batches[i]!;
          const inv = invoiceData[i]!;
          const items = batch.orders.flatMap((o) =>
            o.items.map((it) => ({
              productId: it.productId,
              productName: it.productName,
              productCode: "",
              quantity: it.qty,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
            })),
          );
          const trx = await tx.transaction.create({
            data: {
              invoiceNumber: inv.invoiceNumber,
              invoiceDisplayNumber: inv.invoiceDisplayNumber,
              companyId,
              userId: userForTx.id,
              branchId,
              subtotal: batch.amount,
              discountAmount: 0,
              taxAmount: 0,
              grandTotal: batch.amount,
              paymentMethod,
              paymentAmount: batch.amount,
              changeAmount: 0,
              status: "COMPLETED",
              tableId,
              notes: mergeTransactions
                ? `Pembayaran online via ${paymentMethod} dari customer (tablet)`
                : `Pembayaran online via ${paymentMethod} — split bill (1 dari ${batches.length})`,
              items: { create: items },
            },
            select: { id: true },
          });
          createdTransactionIds.push(trx.id);
        }
      }

      // 2. Mark payment PAID + simpan rawPayload
      const baseRaw = (current.rawPayload as Record<string, unknown> | null) ?? {};
      await tx.tableSessionPayment.update({
        where: { id: paymentId },
        data: {
          status: "PAID",
          paidAt,
          rawPayload: {
            ...baseRaw,
            coveredOrderIds: orders.map((o) => o.id),
            ...(createdTransactionIds.length > 0
              ? { transactionIds: createdTransactionIds }
              : {}),
          },
        },
      });

      // 3. Update session paidAmount (increment untuk multi-checkout) +
      //    link transactionId kalau session belum ke-link sebelumnya
      //    (TableSession.transactionId UNIQUE — cuma boleh satu, jadi
      //    ambil yang pertama).
      const sessionData = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { transactionId: true },
      });
      const firstTxId = createdTransactionIds[0] ?? null;
      await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          paidAmount: { increment: amount },
          ...(firstTxId && !sessionData?.transactionId
            ? { transactionId: firstTxId }
            : {}),
        },
      });
    });

    this.realtime.emit(
      EVENTS.TABLE_PAYMENT_UPDATED,
      {
        paymentId,
        sessionId,
        status: "PAID",
        paidAt: paidAt.toISOString(),
        transactionIds: createdTransactionIds,
      },
      branchId,
    );
    this.realtime.emit(
      EVENTS.TABLE_SESSION_UPDATED,
      { sessionId, paidAmount: amount },
      branchId,
    );
    // Emit TRANSACTION_CREATED per transaction supaya halaman riwayat
    // transaksi (POS) auto-refresh — split bill = N events.
    for (const txId of createdTransactionIds) {
      this.realtime.emit(
        EVENTS.TRANSACTION_CREATED,
        { transactionId: txId, sessionId, tableId },
        branchId,
      );
    }
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

// ────────────────────────────────────────────────────────────────────
// Mock gateway payload — sesuai shape response Xendit asli.
// ────────────────────────────────────────────────────────────────────
type MockGatewayPayload = {
  externalId: string;
  qrString: string | null;
  paymentUrl: string | null;
  expiresAt: string | null;
  actions: {
    desktopWebCheckoutUrl: string | null;
    mobileWebCheckoutUrl: string | null;
    mobileDeeplinkCheckoutUrl: string | null;
    qrCheckoutString: string | null;
  } | null;
  bankCode: string | null;
  accountNumber: string | null;
  vaName: string | null;
  rawPayload: Record<string, unknown>;
};

const VA_BANK_NAMES: Record<string, string> = {
  BCA: "Bank Central Asia",
  BNI: "Bank Negara Indonesia",
  BRI: "Bank Rakyat Indonesia",
  MANDIRI: "Bank Mandiri",
  PERMATA: "Bank Permata",
  BSI: "Bank Syariah Indonesia",
  CIMB: "CIMB Niaga",
  BJB: "Bank Jabar Banten",
};

/**
 * Build mock payload Xendit. Channel-aware: QRIS pakai qrString (EMV-like
 * agar QR image yang di-render frontend valid scannable shape), e-wallet
 * pakai actions + redirect URL, transfer pakai VA number.
 */
function buildMockGatewayPayload(
  dto: StartOnlinePaymentDto,
  amount: number,
): MockGatewayPayload {
  const externalId = `mock-xnd-${cryptoRandom()}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const channel = (dto.channel ?? "").toUpperCase();

  // QRIS — return qrString berupa string EMV-QRIS yang valid-shape
  // (encoder QRcode.toDataURL bisa render apa pun string, jadi cukup
  // string unik biar setiap order beda QR-nya).
  if (channel === "QRIS" || channel === "") {
    const qrString = buildMockQrisPayload(externalId, amount);
    return {
      externalId,
      qrString,
      paymentUrl: null,
      expiresAt,
      actions: null,
      bankCode: null,
      accountNumber: null,
      vaName: null,
      rawPayload: { mock: true, channel: "QRIS", qrString, expiresAt },
    };
  }

  // EWALLET — semua channel dapat mock checkout URL; OVO biasanya tidak
  // butuh redirect (cuma push notif), tapi mock-nya kita kasih URL juga
  // supaya UI customer punya something to interact with.
  if (channel.startsWith("EWALLET") || channel === "EWALLET") {
    const checkoutUrl = `https://checkout.xendit.co/web/mock/${externalId}`;
    const deeplink = `xendit://mock-checkout/${externalId}`;
    return {
      externalId,
      qrString: null,
      paymentUrl: checkoutUrl,
      expiresAt,
      actions: {
        desktopWebCheckoutUrl: checkoutUrl,
        mobileWebCheckoutUrl: checkoutUrl,
        mobileDeeplinkCheckoutUrl: deeplink,
        qrCheckoutString: null,
      },
      bankCode: null,
      accountNumber: null,
      vaName: null,
      rawPayload: { mock: true, channel: dto.channel ?? "EWALLET", expiresAt },
    };
  }

  // TRANSFER (Virtual Account) — generate 12-digit mock account number.
  if (channel === "TRANSFER" || channel === "VA" || dto.bankCode) {
    const bank = (dto.bankCode ?? "BCA").toUpperCase();
    const accountNumber = `880${randomDigits(10)}`;
    const vaName = dto.customerName?.trim() || "Customer Tablet";
    return {
      externalId,
      qrString: null,
      paymentUrl: null,
      expiresAt,
      actions: null,
      bankCode: bank,
      accountNumber,
      vaName: `${vaName} (${VA_BANK_NAMES[bank] ?? bank})`,
      rawPayload: { mock: true, channel: "TRANSFER", bank, accountNumber, expiresAt },
    };
  }

  // Default fallback — generic invoice mode dengan paymentUrl.
  const paymentUrl = `https://checkout.xendit.co/web/mock/${externalId}`;
  return {
    externalId,
    qrString: null,
    paymentUrl,
    expiresAt,
    actions: null,
    bankCode: null,
    accountNumber: null,
    vaName: null,
    rawPayload: { mock: true, channel: dto.channel ?? null, expiresAt },
  };
}

function buildMockQrisPayload(externalId: string, amount: number): string {
  // EMV-QRIS-like format (versi minimal): cukup untuk QR-encoder generate
  // QR image yang scannable shape-nya. Bukan QRIS valid yang bisa
  // di-resolve di app m-banking — ini mock semata-mata untuk preview UI.
  // Field penting: payload format indicator (00), merchant info, currency,
  // amount, country, merchant name, reference.
  const merchantName = "MENOPOS MOCK";
  const reference = externalId.replace(/-/g, "").slice(0, 16).toUpperCase();
  const amountStr = amount.toFixed(0);
  // Construct simple TLV (tag-length-value). Bukan official QRIS standard
  // tapi cukup jadi string unik per payment supaya QR-nya beda-beda.
  return [
    "000201",
    `0102${pad("12")}`,
    `52${pad("0000")}`,
    `5303360`,
    `54${pad(amountStr)}`,
    "5802ID",
    `59${pad(merchantName)}`,
    "6007Jakarta",
    `62${pad(`05${pad(reference, 2)}`)}`,
  ].join("");
}

function pad(value: string, lenPadDigits = 2): string {
  const len = String(value.length).padStart(lenPadDigits, "0");
  return `${len}${value}`;
}

function cryptoRandom(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

function randomDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}
