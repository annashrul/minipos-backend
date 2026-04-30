import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  StartOnlinePaymentDto,
  SubmitTableOrderDto,
  TableOrderResponse,
  TablePaymentResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { findTableByToken } from "./table-orders.helpers";
import { toOrderResponse } from "./table-orders.mapper";
import { ORDER_SELECT } from "./table-orders.select";

@Injectable()
export class TableOrderSubmitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async submitOrder(
    qrToken: string,
    dto: SubmitTableOrderDto,
  ): Promise<TableOrderResponse> {
    const table = await findTableByToken(this.prisma, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        sellingPrice: true,
        unit: true,
        units: {
          select: { id: true, name: true, conversionQty: true, sellingPrice: true },
        },
        modifierGroups: {
          include: {
            modifierGroup: { include: { options: true } },
          },
        },
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      throw new BadRequestException("Beberapa produk tidak ditemukan / tidak aktif");
    }

    let total = 0;
    const itemsData = dto.items.map((i) => {
      const p = productMap.get(i.productId)!;

      let unitName = p.unit;
      let unitPrice = p.sellingPrice;
      if (i.unitId) {
        const unit = p.units.find((u) => u.id === i.unitId);
        if (!unit) {
          throw new BadRequestException(`Satuan tidak valid untuk produk ${p.name}`);
        }
        unitName = unit.name;
        unitPrice = unit.sellingPrice;
      }

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
        const linkedGroupIds = new Set(p.modifierGroups.map((l) => l.modifierGroupId));
        for (const s of sel) {
          if (!linkedGroupIds.has(s.groupId)) {
            throw new BadRequestException(`Modifier tidak valid untuk produk ${p.name}`);
          }
          const link = p.modifierGroups.find((l) => l.modifierGroupId === s.groupId);
          const group = link?.modifierGroup;
          const opt = group?.options.find((o) => o.id === s.optionId);
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
        const grouped = new Map<string, number>();
        for (const m of sel) grouped.set(m.groupId, (grouped.get(m.groupId) ?? 0) + 1);
        for (const link of p.modifierGroups) {
          const g = link.modifierGroup;
          const count = grouped.get(g.id) ?? 0;
          const min = g.required ? Math.max(1, g.minSelect ?? 0) : g.minSelect ?? 0;
          if (count < min) {
            throw new BadRequestException(`Modifier "${g.name}" minimal ${min} pilihan`);
          }
          if (g.maxSelect && count > g.maxSelect) {
            throw new BadRequestException(`Modifier "${g.name}" maksimal ${g.maxSelect} pilihan`);
          }
        }
      } else {
        const requiredMissing = p.modifierGroups.find(
          (l) => l.modifierGroup.required && (l.modifierGroup.minSelect ?? 1) > 0,
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

      const modifierLabel = modifierSnapshot.length > 0
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
      let session = await tx.tableSession.findFirst({
        where: { tableId: table.id, status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
        select: { id: true, status: true, subtotal: true, customerName: true, customerPhone: true },
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
          select: { id: true, status: true, subtotal: true, customerName: true, customerPhone: true },
        });
      } else if (session.status === "AWAITING_PAYMENT") {
        throw new BadRequestException(
          "Sesi sedang menunggu pembayaran — tidak bisa tambah order",
        );
      } else {
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
      { orderId: resp.id, sessionId: resp.sessionId, tableId: resp.tableId, total: resp.total },
      table.branch.id,
    );
    return resp;
  }

  async startOnlinePayment(
    qrToken: string,
    sessionId: string,
    dto: StartOnlinePaymentDto,
  ): Promise<TablePaymentResponse> {
    const table = await findTableByToken(this.prisma, qrToken);
    const session = await this.prisma.tableSession.findFirst({
      where: { id: sessionId, tableId: table.id },
      select: { id: true, status: true, subtotal: true, branchId: true },
    });
    if (!session) throw new NotFoundException("Sesi tidak ditemukan");
    if (session.status === "CLOSED") {
      throw new BadRequestException("Sesi sudah ditutup");
    }
    if (session.subtotal <= 0) {
      throw new BadRequestException("Belum ada order yang bisa dibayar");
    }

    const payment = await this.prisma.tableSessionPayment.create({
      data: {
        sessionId: session.id,
        provider: dto.provider,
        channel: dto.channel ?? null,
        amount: session.subtotal,
        status: "PENDING",
      },
      select: {
        id: true,
        sessionId: true,
        provider: true,
        channel: true,
        amount: true,
        status: true,
        externalId: true,
        paidAt: true,
        createdAt: true,
      },
    });

    await this.prisma.tableSession.update({
      where: { id: session.id },
      data: { status: "AWAITING_PAYMENT" },
    });

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
}
