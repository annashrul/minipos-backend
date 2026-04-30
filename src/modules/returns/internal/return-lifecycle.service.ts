import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RejectReturnDto, ReturnDetailResponse } from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { ReturnStockAdjuster } from "./return-stock.adjuster";
import { generateStoreCreditCode } from "./returns.helpers";
import { toReturnDetailResponse } from "./returns.mapper";
import { RETURN_DETAIL_SELECT, tenantWhereClause } from "./returns.select";

@Injectable()
export class ReturnLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: ReturnStockAdjuster,
  ) {}

  async approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...tenantWhereClause(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya retur dengan status PENDING yang dapat disetujui",
      );
    }
    const updated = await this.prisma.returnExchange.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: userId,
        approvedAt: new Date(),
      },
      select: RETURN_DETAIL_SELECT,
    });
    return toReturnDetailResponse(updated);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    dto: RejectReturnDto,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...tenantWhereClause(companyId) },
      select: { id: true, status: true, notes: true },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status === "COMPLETED" || existing.status === "REJECTED") {
      throw new BadRequestException(
        "Retur dengan status ini tidak dapat ditolak",
      );
    }

    const reason = dto.reason?.trim();
    const newNotes = reason
      ? existing.notes
        ? `${existing.notes}\n[REJECTED] ${reason}`
        : `[REJECTED] ${reason}`
      : existing.notes;

    const updated = await this.prisma.returnExchange.update({
      where: { id },
      data: {
        status: "REJECTED",
        notes: newNotes,
        approvedBy: userId,
        approvedAt: new Date(),
      },
      select: RETURN_DETAIL_SELECT,
    });
    return toReturnDetailResponse(updated);
  }

  async complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<ReturnDetailResponse> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...tenantWhereClause(companyId) },
      select: {
        id: true,
        status: true,
        type: true,
        returnNumber: true,
        totalRefund: true,
        refundMethod: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            exchangeProductId: true,
            exchangeQuantity: true,
            restocked: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status !== "APPROVED") {
      throw new BadRequestException(
        "Retur harus dalam status APPROVED untuk diselesaikan",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const branchId = existing.branchId ?? null;

      for (const item of existing.items) {
        if (!item.restocked) {
          await this.stock.apply(tx, {
            productId: item.productId,
            branchId,
            delta: item.quantity,
            reference: existing.returnNumber,
            note: `Retur ${existing.returnNumber}`,
            type: "IN",
            createdBy: userId,
          });
        }

        if (
          existing.type === "EXCHANGE" &&
          item.exchangeProductId &&
          item.exchangeQuantity &&
          item.exchangeQuantity > 0
        ) {
          await this.stock.apply(tx, {
            productId: item.exchangeProductId,
            branchId,
            delta: -item.exchangeQuantity,
            reference: existing.returnNumber,
            note: `Tukar produk ${existing.returnNumber}`,
            type: "OUT",
            createdBy: userId,
          });
        }

        await tx.returnExchangeItem.update({
          where: { id: item.id },
          data: { restocked: true },
        });
      }

      if (
        existing.refundMethod === "STORE_CREDIT" &&
        existing.customerId &&
        existing.totalRefund > 0
      ) {
        await tx.storeCredit.create({
          data: {
            customerId: existing.customerId,
            code: generateStoreCreditCode(existing.returnNumber),
            balance: existing.totalRefund,
            initialAmount: existing.totalRefund,
            isActive: true,
            issuedBy: userId,
          },
        });
      }

      await tx.returnExchange.update({
        where: { id },
        data: { status: "COMPLETED" },
      });

      return tx.returnExchange.findUniqueOrThrow({
        where: { id },
        select: RETURN_DETAIL_SELECT,
      });
    });

    return toReturnDetailResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.returnExchange.findFirst({
      where: { id, ...tenantWhereClause(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Return not found");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya retur dengan status PENDING yang dapat dihapus",
      );
    }
    await this.prisma.$transaction([
      this.prisma.returnExchangeItem.deleteMany({
        where: { returnExchangeId: id },
      }),
      this.prisma.returnExchange.delete({ where: { id } }),
    ]);
    return { success: true };
  }
}
