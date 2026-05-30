import { BadRequestException, Injectable } from "@nestjs/common";
import type { SubmitTableOrderDto, TableOrderResponse } from "./dto/table-orders.dto";
import { ORDER_SELECT, TableOrdersRepository } from "./table-orders.repository";
import {
  findTableByToken,
  cleanupStaleSessions,
  toOrderResponse,
} from "./table-orders.helpers";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";

@Injectable()
export class TableOrderSubmitService {
  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Submit a new order from the tablet. Auto-creates session if none open. */
  async submitOrder(
    qrToken: string,
    dto: SubmitTableOrderDto,
  ): Promise<TableOrderResponse> {
    const table = await findTableByToken(this.repo, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;
    await cleanupStaleSessions(
      this.repo,
      this.prisma,
      this.realtime,
      companyId,
      table.branch.id,
    );

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

    // Meja ONLINE (WhatsApp): satu meja virtual dipakai banyak customer →
    // sesi di-scope per customerPhone supaya tiap customer punya keranjang
    // sendiri. Meja fisik tetap 1 sesi per meja (perilaku lama tidak berubah).
    const scopePhone =
      table.isOnline && dto.customerPhone
        ? dto.customerPhone
        : null;
    if (table.isOnline && !dto.customerPhone) {
      throw new BadRequestException(
        "Nomor WhatsApp wajib untuk pesan online. Buka link pesan dari chat WhatsApp.",
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create open session
      let session = await tx.tableSession.findFirst({
        where: {
          tableId: table.id,
          status: { in: ["OPEN", "AWAITING_PAYMENT"] },
          ...(scopePhone ? { customerPhone: scopePhone } : {}),
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
      } else {
        // NOTE: Flow baru — customer boleh tambah order kapan saja walaupun
        // batch sebelumnya sudah dibayar (multiple checkout per session).
        // Status AWAITING_PAYMENT tidak lagi blok submit.
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

      // Cari order PENDING_APPROVAL yang BELUM dibayar di session ini
      // milik DEVICE yang sama. Kalau ada → merge items ke order tsb
      // (instead of create baru), supaya customer ga punya 2 card
      // transaksi yang sama-sama unpaid. Per-device match supaya orders
      // dari device lain (mis. teman seorang patungan) ga ke-merge.
      // Order yang sudah ke-cover PAID payment di-skip (mereka kunci).
      const existingPending = await tx.tableOrder.findMany({
        where: {
          sessionId: session.id,
          status: "PENDING_APPROVAL",
          ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
        },
        select: {
          id: true,
          total: true,
          customerNote: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              qty: true,
              unitPrice: true,
              subtotal: true,
              note: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      const paidPayments = await tx.tableSessionPayment.findMany({
        where: { sessionId: session.id, status: "PAID" },
        select: { rawPayload: true },
      });
      const coveredOrderIds = new Set<string>();
      for (const p of paidPayments) {
        const raw = p.rawPayload as Record<string, unknown> | null;
        const ids = raw?.["coveredOrderIds"];
        if (Array.isArray(ids)) {
          for (const id of ids) if (typeof id === "string") coveredOrderIds.add(id);
        }
      }
      // Ambil unpaid pending paling baru (kalau ada >1 unpaid, merge ke
      // yang terakhir dibuat — paling natural buat customer).
      const targetExisting = existingPending.find((o) => !coveredOrderIds.has(o.id));

      let order;
      if (targetExisting) {
        // ── MERGE PATH ─────────────────────────────────────────────
        // Dedupe items by productId + productName + unitPrice + note.
        // Match → increment qty + subtotal. Beda → tambah row baru.
        let totalDelta = 0;
        for (const newItem of itemsData) {
          const match = targetExisting.items.find(
            (e) =>
              e.productId === newItem.productId &&
              e.productName === newItem.productName &&
              e.unitPrice === newItem.unitPrice &&
              (e.note ?? "") === (newItem.note ?? ""),
          );
          if (match) {
            const newQty = match.qty + newItem.qty;
            const newSubtotal = newQty * newItem.unitPrice;
            const delta = newSubtotal - match.subtotal;
            await tx.tableOrderItem.update({
              where: { id: match.id },
              data: { qty: newQty, subtotal: newSubtotal },
            });
            totalDelta += delta;
          } else {
            await tx.tableOrderItem.create({
              data: {
                orderId: targetExisting.id,
                productId: newItem.productId,
                productName: newItem.productName,
                qty: newItem.qty,
                unitPrice: newItem.unitPrice,
                subtotal: newItem.subtotal,
                note: newItem.note,
              },
            });
            totalDelta += newItem.subtotal;
          }
        }
        // Update order total + customerNote (gabung note kalau ada baru)
        const mergedNote = dto.customerNote
          ? targetExisting.customerNote
            ? `${targetExisting.customerNote}\n${dto.customerNote}`
            : dto.customerNote
          : targetExisting.customerNote;
        order = await tx.tableOrder.update({
          where: { id: targetExisting.id },
          data: {
            total: { increment: totalDelta },
            customerNote: mergedNote,
            updatedAt: new Date(),
          },
          select: ORDER_SELECT,
        });
        await tx.tableSession.update({
          where: { id: session.id },
          data: { subtotal: { increment: totalDelta } },
        });
      } else {
        // ── CREATE NEW PATH ───────────────────────────────────────
        order = await tx.tableOrder.create({
          data: {
            sessionId: session.id,
            tableId: table.id,
            branchId: table.branch!.id,
            status: "PENDING_APPROVAL",
            total,
            customerNote: dto.customerNote ?? null,
            deviceId: dto.deviceId ?? null,
            customerPhone: dto.customerPhone ?? null,
            items: { create: itemsData },
          },
          select: ORDER_SELECT,
        });
        await tx.tableSession.update({
          where: { id: session.id },
          data: { subtotal: { increment: total } },
        });
      }

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
}
