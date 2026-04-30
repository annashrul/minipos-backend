import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreatePurchaseDto,
  PurchaseOrderDetailResponse,
  PurchaseOrderStatusDto,
  UpdatePurchaseDto,
  UpdatePurchaseStatusDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  assertBranch,
  assertSupplier,
  generateOrderNumber,
  isOrderNumberConflict,
} from "./purchases.helpers";
import { toPurchaseDetailResponse } from "./purchases.mapper";
import {
  ALLOWED_TRANSITIONS,
  PO_DETAIL_SELECT,
  tenantWhere,
} from "./purchases.select";

const MAX_ORDER_NUMBER_RETRIES = 3;

@Injectable()
export class PurchaseWriteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseDto,
    retryCount = 0,
  ): Promise<PurchaseOrderDetailResponse> {
    await assertSupplier(this.prisma, companyId, dto.supplierId);
    if (dto.branchId) await assertBranch(this.prisma, companyId, dto.branchId);

    const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
    const orderNumber = generateOrderNumber();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            supplierId: dto.supplierId,
            branchId: dto.branchId ?? null,
            companyId,
            status: "DRAFT",
            totalAmount,
            notes: dto.notes ?? null,
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
            createdBy: userId,
            items: {
              create: dto.items.map((it) => ({
                productId: it.productId,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
              })),
            },
          },
          select: { id: true },
        });

        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: po.id },
          select: PO_DETAIL_SELECT,
        });
      });

      return toPurchaseDetailResponse(created);
    } catch (err) {
      if (isOrderNumberConflict(err) && retryCount < MAX_ORDER_NUMBER_RETRIES) {
        return this.create(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT" && existing.status !== "ORDERED") {
      throw new BadRequestException(
        "Purchase order hanya bisa diubah saat status DRAFT atau ORDERED",
      );
    }

    if (dto.supplierId)
      await assertSupplier(this.prisma, companyId, dto.supplierId);
    if (dto.branchId) await assertBranch(this.prisma, companyId, dto.branchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (dto.supplierId !== undefined) {
        data.supplier = { connect: { id: dto.supplierId } };
      }
      if (dto.branchId !== undefined) {
        data.branch = dto.branchId
          ? { connect: { id: dto.branchId } }
          : { disconnect: true };
      }
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.expectedDate !== undefined) {
        data.expectedDate = dto.expectedDate
          ? new Date(dto.expectedDate)
          : null;
      }

      if (dto.items) {
        const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
        data.totalAmount = totalAmount;
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((it) => ({
            purchaseOrderId: id,
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
          })),
        });
      }

      await tx.purchaseOrder.update({ where: { id }, data });

      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        select: PO_DETAIL_SELECT,
      });
    });

    return toPurchaseDetailResponse(updated);
  }

  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdatePurchaseStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");

    const current = existing.status as PurchaseOrderStatusDto;
    const next = dto.status;
    if (current === next) {
      throw new BadRequestException(`Status sudah ${current}`);
    }
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Transisi status dari ${current} ke ${next} tidak diizinkan`,
      );
    }

    const data: Prisma.PurchaseOrderUpdateInput = { status: next };
    if (next === "RECEIVED") data.receivedDate = new Date();
    if (next === "CLOSED") data.closedDate = new Date();

    await this.prisma.purchaseOrder.update({ where: { id }, data });

    const refreshed = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: PO_DETAIL_SELECT,
    });
    return toPurchaseDetailResponse(refreshed);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        _count: { select: { goodsReceipts: true } },
      },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya purchase order dengan status DRAFT yang bisa dihapus",
      );
    }
    if (existing._count.goodsReceipts > 0) {
      throw new BadRequestException(
        "Purchase order yang sudah memiliki penerimaan tidak bisa dihapus",
      );
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
    return { success: true };
  }
}
