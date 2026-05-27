import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PaymentMethod } from "@prisma/client";
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
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import {
  ORDER_SELECT,
  SESSION_SELECT,
  TableOrdersRepository,
  type RawOrder,
  type RawSession,
} from "./table-orders.repository";

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class TableOrdersService {
  private static readonly STALE_SESSION_MS = readPositiveInt(
    "TABLE_ORDER_AUTO_CANCEL_MS",
    5 * 60 * 60_000,
  );

  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private async cleanupStaleSessions(
    companyId: string,
    branchId?: string | null,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - TableOrdersService.STALE_SESSION_MS);
    const stale = await this.repo.findStaleSessions(companyId, cutoff, branchId);
    if (stale.length === 0) return;

    const sessionIds = stale.map((s) => s.id);
    const tableIds = [...new Set(stale.map((s) => s.tableId))];
    const branchIds = [...new Set(stale.map((s) => s.branchId))];
    const orderIds = stale.flatMap((s) => s.orders.map((o) => o.id));

    await this.prisma.$transaction(async (tx) => {
      await tx.tableOrder.updateMany({
        where: {
          sessionId: { in: sessionIds },
          status: {
            in: [
              "PENDING_APPROVAL",
              "APPROVED",
              "SENT_TO_KITCHEN",
              "READY",
              "SERVED",
            ],
          },
        },
        data: {
          status: "CANCELLED",
          rejectReason: "Auto-cancel: pesanan tidak diproses lebih dari 5 jam.",
        },
      });
      await tx.tableSessionPayment.updateMany({
        where: { sessionId: { in: sessionIds }, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await tx.tableSession.updateMany({
        where: { id: { in: sessionIds } },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      await tx.restaurantTable.updateMany({
        where: {
          id: { in: tableIds },
          tableSessions: {
            none: { status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
          },
        },
        data: { status: "AVAILABLE" },
      });
    });

    for (const bid of branchIds) {
      this.realtime.emit(
        EVENTS.TABLE_ORDER_STATUS,
        {
          reason: "auto_cancel_stale",
          sessionIds,
          orderIds,
          expiredAfterMs: TableOrdersService.STALE_SESSION_MS,
        },
        bid,
      );
      this.realtime.emit(
        EVENTS.TABLE_SESSION_CLOSED,
        {
          reason: "auto_cancel_stale",
          sessionIds,
          tableIds,
          expiredAfterMs: TableOrdersService.STALE_SESSION_MS,
        },
        bid,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // PUBLIC (tablet) — looked up by qrToken
  // ────────────────────────────────────────────────────────────
  async getPublicTableInfo(
    qrToken: string,
  ): Promise<PublicTableInfoResponseDto> {
    const table = await this.findTableByToken(qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    return {
      table: {
        id: table.id,
        number: table.number,
        name: table.name,
        section: table.section,
      },
      branch: {
        id: table.branch.id,
        name: table.branch.name,
      },
      companyId: table.branch.companyId,
    };
  }

  /**
   * Lightweight catalog header — categories only.
   * Products are fetched separately via `getPublicProducts` (paginated).
   */
  async getPublicCatalog(qrToken: string): Promise<PublicCatalogResponse> {
    const table = await this.findTableByToken(qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const categories = await this.repo.findCatalogCategories(table.branch.companyId);
    return { categories, products: [] };
  }

  /**
   * Cursor-based pagination for tablet menu.
   * Cursor = last product `id` in previous page (orderBy id asc — stable + indexed).
   */
  async getPublicProducts(
    qrToken: string,
    query: PublicProductsQueryDto,
  ): Promise<PublicProductsPageResponse> {
    const table = await this.findTableByToken(qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;
    const limit = query.limit;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      itemType: { not: "INGREDIENT" },
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await this.repo.findPublicProducts(where, limit, query.cursor);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]!.id : null;

    return {
      products: slice.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        sellingPrice: p.sellingPrice,
        imageUrl: p.imageUrl,
        description: p.description,
        unit: p.unit,
        hasUnits: p._count.units > 0,
        hasModifiers: p._count.modifierGroups > 0,
      })),
      nextCursor,
    };
  }

  async getPublicProductDetail(
    qrToken: string,
    productId: string,
  ): Promise<PublicProductDetailResponse> {
    const table = await this.findTableByToken(qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const product = await this.repo.findPublicProductDetail(
      table.branch.companyId,
      productId,
    );
    if (!product) throw new NotFoundException("Produk tidak ditemukan");

    return {
      id: product.id,
      name: product.name,
      code: product.code,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      sellingPrice: product.sellingPrice,
      imageUrl: product.imageUrl,
      description: product.description,
      unit: product.unit,
      units: product.units.map((u) => ({
        id: u.id,
        name: u.name,
        conversionQty: u.conversionQty,
        sellingPrice: u.sellingPrice,
        isDefault: u.isDefault,
      })),
      modifierGroups: product.modifierGroups
        .filter((link) => link.modifierGroup.isActive)
        .map((link) => {
          const g = link.modifierGroup;
          return {
            id: g.id,
            name: g.name,
            required: g.required,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options
              .filter((o) => o.isActive)
              .map((o) => ({
                id: o.id,
                name: o.name,
                priceAdjustment: o.priceAdjustment,
              })),
          };
        }),
    };
  }

  /** Get the active session for a table (or null if none). */
  async getPublicActiveSession(
    qrToken: string,
  ): Promise<TableSessionResponse | null> {
    const table = await this.findTableByToken(qrToken);
    if (table.branch) {
      await this.cleanupStaleSessions(table.branch.companyId, table.branch.id);
    }
    const session = await this.repo.findActiveSession(table.id);
    return session ? toSessionResponse(session) : null;
  }

  /** Submit a new order from the tablet. Auto-creates session if none open. */
  async submitOrder(
    qrToken: string,
    dto: SubmitTableOrderDto,
  ): Promise<TableOrderResponse> {
    const table = await this.findTableByToken(qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;
    await this.cleanupStaleSessions(companyId, table.branch.id);

    // Resolve product prices server-side (don't trust client).
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.repo.findProductsForOrder(companyId, productIds);
    const productMap = new Map(products.map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      throw new BadRequestException(
        "Beberapa produk tidak ditemukan / tidak aktif",
      );
    }

    // Pre-build lookup maps per product for O(1) access in the items loop.
    const unitMapByProduct = new Map<string, Map<string, (typeof products)[0]["units"][0]>>();
    const modGroupMapByProduct = new Map<string, Map<string, (typeof products)[0]["modifierGroups"][0]>>();
    const optionMapByGroup = new Map<string, Map<string, (typeof products)[0]["modifierGroups"][0]["modifierGroup"]["options"][0]>>();

    for (const p of products) {
      unitMapByProduct.set(p.id, new Map(p.units.map((u) => [u.id, u])));
      modGroupMapByProduct.set(p.id, new Map(p.modifierGroups.map((l) => [l.modifierGroupId, l])));
      for (const l of p.modifierGroups) {
        optionMapByGroup.set(l.modifierGroup.id, new Map(l.modifierGroup.options.map((o) => [o.id, o])));
      }
    }

    let total = 0;
    const itemsData = dto.items.map((i) => {
      const p = productMap.get(i.productId)!;
      const unitMap = unitMapByProduct.get(p.id)!;
      const modGroupMap = modGroupMapByProduct.get(p.id)!;

      // Resolve unit (fallback to base unit when no unitId provided)
      let unitName = p.unit;
      let unitPrice = p.sellingPrice;
      if (i.unitId) {
        const unit = unitMap.get(i.unitId);
        if (!unit) {
          throw new BadRequestException(
            `Satuan tidak valid untuk produk ${p.name}`,
          );
        }
        unitName = unit.name;
        unitPrice = unit.sellingPrice;
      }

      // Resolve modifier selections + price adjustment
      let modifierAdjust = 0;
      const modifierSnapshot: Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceAdjustment: number;
      }> = [];
      const sel = i.modifiers ?? [];
      if (sel.length > 0) {
        for (const s of sel) {
          if (!modGroupMap.has(s.groupId)) {
            throw new BadRequestException(
              `Modifier tidak valid untuk produk ${p.name}`,
            );
          }
          const link = modGroupMap.get(s.groupId);
          const group = link?.modifierGroup;
          const optMap = group ? optionMapByGroup.get(group.id) : undefined;
          const opt = optMap?.get(s.optionId);
          if (!group || !opt) {
            throw new BadRequestException(`Opsi modifier tidak ditemukan`);
          }
          modifierAdjust += opt.priceAdjustment;
          modifierSnapshot.push({
            groupId: group.id,
            groupName: group.name,
            optionId: opt.id,
            optionName: opt.name,
            priceAdjustment: opt.priceAdjustment,
          });
        }
        // Validate min/max per group
        const grouped = new Map<string, number>();
        for (const m of sel)
          grouped.set(m.groupId, (grouped.get(m.groupId) ?? 0) + 1);
        for (const link of p.modifierGroups) {
          const g = link.modifierGroup;
          const count = grouped.get(g.id) ?? 0;
          const min = g.required
            ? Math.max(1, g.minSelect ?? 0)
            : (g.minSelect ?? 0);
          if (count < min) {
            throw new BadRequestException(
              `Modifier "${g.name}" minimal ${min} pilihan`,
            );
          }
          if (g.maxSelect && count > g.maxSelect) {
            throw new BadRequestException(
              `Modifier "${g.name}" maksimal ${g.maxSelect} pilihan`,
            );
          }
        }
      } else {
        // Required group present but not selected
        const requiredMissing = p.modifierGroups.find(
          (l) =>
            l.modifierGroup.required && (l.modifierGroup.minSelect ?? 1) > 0,
        );
        if (requiredMissing) {
          throw new BadRequestException(
            `Modifier "${requiredMissing.modifierGroup.name}" wajib dipilih`,
          );
        }
      }

      const finalUnitPrice = unitPrice + modifierAdjust;
      const subtotal = finalUnitPrice * i.qty;
      total += subtotal;

      // Compose name + note: include modifier summary in productName for kitchen
      const modifierLabel =
        modifierSnapshot.length > 0
          ? ` (${modifierSnapshot.map((m) => m.optionName).join(", ")})`
          : "";
      const productNameSnap = i.unitId
        ? `${p.name} - ${unitName}${modifierLabel}`
        : `${p.name}${modifierLabel}`;

      return {
        productId: p.id,
        productName: productNameSnap,
        qty: i.qty,
        unitPrice: finalUnitPrice,
        subtotal,
        note: i.note ?? null,
      };
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create open session
      let session = await tx.tableSession.findFirst({
        where: {
          tableId: table.id,
          status: { in: ["OPEN", "AWAITING_PAYMENT"] },
        },
        select: {
          id: true,
          status: true,
          subtotal: true,
          customerName: true,
          customerPhone: true,
        },
        orderBy: { openedAt: "desc" },
      });
      if (!session) {
        session = await tx.tableSession.create({
          data: {
            tableId: table.id,
            branchId: table.branch!.id,
            status: "OPEN",
            customerName: dto.customerName ?? null,
            customerPhone: dto.customerPhone ?? null,
          },
          select: {
            id: true,
            status: true,
            subtotal: true,
            customerName: true,
            customerPhone: true,
          },
        });
      } else if (session.status === "AWAITING_PAYMENT") {
        throw new BadRequestException(
          "Sesi sedang menunggu pembayaran — tidak bisa tambah order",
        );
      } else {
        // Backfill customer info if previously empty
        if (
          (!session.customerName && dto.customerName) ||
          (!session.customerPhone && dto.customerPhone)
        ) {
          await tx.tableSession.update({
            where: { id: session.id },
            data: {
              customerName: session.customerName ?? dto.customerName ?? null,
              customerPhone: session.customerPhone ?? dto.customerPhone ?? null,
            },
          });
        }
      }

      const order = await tx.tableOrder.create({
        data: {
          sessionId: session.id,
          tableId: table.id,
          branchId: table.branch!.id,
          status: "PENDING_APPROVAL",
          total,
          customerNote: dto.customerNote ?? null,
          items: { create: itemsData },
        },
        select: ORDER_SELECT,
      });

      await tx.tableSession.update({
        where: { id: session.id },
        data: { subtotal: { increment: total } },
      });

      // Mark table OCCUPIED
      if (table.status === "AVAILABLE") {
        await tx.restaurantTable.update({
          where: { id: table.id },
          data: { status: "OCCUPIED" },
        });
      }

      return order;
    });

    const resp = toOrderResponse(result);
    this.realtime.emit(
      EVENTS.TABLE_ORDER_CREATED,
      {
        orderId: resp.id,
        sessionId: resp.sessionId,
        tableId: resp.tableId,
        total: resp.total,
      },
      table.branch.id,
    );
    return resp;
  }

  // ────────────────────────────────────────────────────────────
  // KASIR (authenticated)
  // ────────────────────────────────────────────────────────────
  async listOrders(
    companyId: string,
    query: ListTableOrdersQueryDto,
  ): Promise<TableOrderListResponse> {
    await this.cleanupStaleSessions(companyId, query.branchId);
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
    await this.cleanupStaleSessions(companyId, query.branchId);
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
  // PAYMENT FOUNDATION (online — provider-agnostic)
  // ────────────────────────────────────────────────────────────
  async startOnlinePayment(
    qrToken: string,
    sessionId: string,
    dto: StartOnlinePaymentDto,
  ): Promise<TablePaymentResponse> {
    const table = await this.findTableByToken(qrToken);
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
  private async findTableByToken(qrToken: string) {
    const table = await this.repo.findTableByToken(qrToken);
    if (!table || !table.branchId) {
      throw new NotFoundException("Token meja tidak valid");
    }
    return table;
  }

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

// ──────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────
async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const last = await tx.orderQueue.findFirst({
    where: { branchId, createdAt: { gte: startOfDay } },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });
  return (last?.queueNumber ?? 0) + 1;
}

async function nextInvoiceNumber(
  repo: TableOrdersRepository,
  branchId: string,
): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const count = await repo.countTransactionsToday(branchId, startOfDay);
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${ymd}-${seq}`;
}

/**
 * Generate display invoice number "INV-DDMMYYYY-NNNNN" sequential per
 * (companyId, date). Mirror logika di TransactionsService.generateDisplayInvoiceNumber.
 */
async function nextInvoiceDisplayNumber(
  repo: TableOrdersRepository,
  companyId: string,
): Promise<string> {
  const date = new Date();
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const prefix = `INV-${dd}${mm}${yyyy}-`;

  const last = await repo.findLastInvoiceDisplayNumber(companyId, prefix);

  let nextSeq = 1;
  if (last?.invoiceDisplayNumber) {
    const tail = last.invoiceDisplayNumber.slice(prefix.length);
    const parsed = parseInt(tail, 10);
    if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
  }
  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

function toOrderResponse(o: RawOrder): TableOrderResponse {
  return {
    id: o.id,
    sessionId: o.sessionId,
    tableId: o.tableId,
    branchId: o.branchId,
    status: o.status,
    total: o.total,
    customerNote: o.customerNote,
    rejectReason: o.rejectReason,
    approvedBy: o.approvedBy,
    approvedAt: o.approvedAt ? o.approvedAt.toISOString() : null,
    orderQueueId: o.orderQueueId,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    table: o.table
      ? { id: o.table.id, number: o.table.number, name: o.table.name }
      : null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.product?.code ?? "",
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
      note: i.note,
    })),
  };
}

function toSessionResponse(s: RawSession): TableSessionResponse {
  return {
    id: s.id,
    tableId: s.tableId,
    branchId: s.branchId,
    status: s.status,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    subtotal: s.subtotal,
    paidAmount: s.paidAmount,
    transactionId: s.transactionId,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt ? s.closedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    table: s.table
      ? { id: s.table.id, number: s.table.number, name: s.table.name }
      : null,
    orders: s.orders.map(toOrderResponse),
  };
}
