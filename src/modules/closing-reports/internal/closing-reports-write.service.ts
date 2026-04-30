import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClosingReportResponse,
  PaymentSummaryEntry,
  RecloseShiftDto,
  UpdateClosingReportDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CLOSING_REPORT_SELECT,
  tenantWhere,
  toClosingReportResponse,
} from "./closing-reports.shared";

@Injectable()
export class ClosingReportsWriteService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: shiftId, user: { companyId } },
      select: {
        id: true,
        userId: true,
        branchId: true,
        openedAt: true,
        closedAt: true,
        openingCash: true,
        closingCash: true,
        expectedCash: true,
        cashDifference: true,
        isOpen: true,
        user: { select: { id: true, name: true, companyId: true } },
      },
    });
    if (!shift) throw new NotFoundException("Shift not found");
    if (shift.isOpen) {
      throw new BadRequestException(
        "Shift masih terbuka, tutup terlebih dahulu sebelum membuat closing report",
      );
    }
    if (!shift.closedAt) {
      throw new BadRequestException("Shift belum memiliki waktu penutupan");
    }

    const existing = await this.prisma.closingReport.findUnique({
      where: { shiftId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "Closing report sudah ada untuk shift ini",
      );
    }

    const txWhereBase: Prisma.TransactionWhereInput = {
      userId: shift.userId,
      createdAt: { gte: shift.openedAt, lte: shift.closedAt },
    };
    if (shift.branchId) txWhereBase.branchId = shift.branchId;

    const completedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "COMPLETED",
    };
    const cashCompletedWhere: Prisma.TransactionWhereInput = {
      ...completedWhere,
      paymentMethod: "CASH",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "VOIDED",
    };

    const created = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.closingReport.findUnique({
        where: { shiftId },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(
          "Closing report sudah ada untuk shift ini",
        );
      }

      const [
        completedAgg,
        cashAgg,
        refundedAgg,
        voidedAgg,
        cashMovementsGrouped,
        paymentGrouped,
      ] = await Promise.all([
        tx.transaction.aggregate({
          where: completedWhere,
          _sum: {
            grandTotal: true,
            discountAmount: true,
            taxAmount: true,
          },
          _count: { _all: true },
        }),
        tx.transaction.aggregate({
          where: cashCompletedWhere,
          _sum: { grandTotal: true },
        }),
        tx.transaction.aggregate({
          where: refundedWhere,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
        tx.transaction.aggregate({
          where: voidedWhere,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
        tx.cashMovement.groupBy({
          by: ["type"],
          where: { shiftId },
          _sum: { amount: true },
        }),
        tx.transaction.groupBy({
          by: ["paymentMethod"],
          where: completedWhere,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
      ]);

      const totalSales = completedAgg._sum.grandTotal ?? 0;
      const totalDiscount = completedAgg._sum.discountAmount ?? 0;
      const totalTax = completedAgg._sum.taxAmount ?? 0;
      const totalTransactions = completedAgg._count._all;
      const totalCashSales = cashAgg._sum.grandTotal ?? 0;
      const totalNonCashSales = totalSales - totalCashSales;
      const refundCount = refundedAgg._count._all;
      const voidCount = voidedAgg._count._all;

      const cashMovementIn =
        cashMovementsGrouped.find((m) => m.type === "CASH_IN")?._sum.amount ?? 0;
      const cashMovementOut =
        cashMovementsGrouped.find((m) => m.type === "CASH_OUT")?._sum.amount ??
        0;

      const paymentSummary: PaymentSummaryEntry[] = paymentGrouped
        .map((p) => ({
          method: p.paymentMethod,
          count: p._count._all,
          total: p._sum.grandTotal ?? 0,
        }))
        .sort((a, b) => b.total - a.total);

      const closedAt = shift.closedAt as Date;

      return tx.closingReport.create({
        data: {
          shiftId: shift.id,
          cashierUserId: shift.userId,
          branchId: shift.branchId ?? null,
          companyId: shift.user?.companyId ?? companyId,
          cashierName: shift.user?.name ?? "",
          date: closedAt,
          openingCash: shift.openingCash,
          closingCash: shift.closingCash ?? 0,
          expectedCash: shift.expectedCash ?? 0,
          cashDifference: shift.cashDifference ?? 0,
          totalTransactions,
          totalSales,
          totalDiscount,
          totalTax,
          totalCashSales,
          totalNonCashSales,
          cashMovementIn,
          cashMovementOut,
          voidCount,
          refundCount,
          paymentSummary:
            paymentSummary.length > 0
              ? (paymentSummary as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
        select: CLOSING_REPORT_SELECT,
      });
    });

    return toClosingReportResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateClosingReportDto,
  ): Promise<ClosingReportResponse> {
    const existing = await this.prisma.closingReport.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Closing report not found");

    const data: Prisma.ClosingReportUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.prisma.closingReport.update({
      where: { id },
      data,
      select: CLOSING_REPORT_SELECT,
    });
    return toClosingReportResponse(updated);
  }

  async recloseShift(
    companyId: string,
    shiftId: string,
    dto: RecloseShiftDto,
  ): Promise<ClosingReportResponse> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { id: shiftId, user: { companyId } },
      select: {
        id: true,
        userId: true,
        branchId: true,
        openedAt: true,
        closedAt: true,
        openingCash: true,
        isOpen: true,
        user: { select: { id: true, name: true } },
      },
    });
    if (!shift) throw new NotFoundException("Shift tidak ditemukan");
    if (shift.isOpen) {
      throw new BadRequestException(
        "Shift masih terbuka, tidak dapat di-reclose",
      );
    }
    if (!shift.closedAt) {
      throw new BadRequestException("Shift belum ditutup");
    }

    const closedAt = shift.closedAt;
    const openedAt = shift.openedAt;

    // Re-aggregate sales + cash flow within the shift window so
    // expectedCash and cashDifference reflect current data.
    const txWhereBase: Prisma.TransactionWhereInput = {
      userId: shift.userId,
      createdAt: { gte: openedAt, lte: closedAt },
    };
    if (shift.branchId) txWhereBase.branchId = shift.branchId;

    const completedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "COMPLETED",
    };
    const cashCompletedWhere: Prisma.TransactionWhereInput = {
      ...completedWhere,
      paymentMethod: "CASH",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "VOIDED",
    };

    const [
      completedAgg,
      cashAgg,
      refundedAgg,
      voidedAgg,
      cashMovementsGrouped,
      paymentGrouped,
    ] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: completedWhere,
        _sum: { grandTotal: true, discountAmount: true, taxAmount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: cashCompletedWhere,
        _sum: { grandTotal: true },
      }),
      this.prisma.transaction.aggregate({
        where: refundedWhere,
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: voidedWhere,
        _count: { _all: true },
      }),
      this.prisma.cashMovement.groupBy({
        by: ["type"],
        where: { shiftId },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["paymentMethod"],
        where: completedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
    ]);

    const totalSales = completedAgg._sum.grandTotal ?? 0;
    const totalDiscount = completedAgg._sum.discountAmount ?? 0;
    const totalTax = completedAgg._sum.taxAmount ?? 0;
    const totalTransactions = completedAgg._count._all;
    const totalCashSales = cashAgg._sum.grandTotal ?? 0;
    const totalNonCashSales = totalSales - totalCashSales;
    const refundCount = refundedAgg._count._all;
    const voidCount = voidedAgg._count._all;

    const cashMovementIn =
      cashMovementsGrouped.find((m) => m.type === "CASH_IN")?._sum.amount ?? 0;
    const cashMovementOut =
      cashMovementsGrouped.find((m) => m.type === "CASH_OUT")?._sum.amount ?? 0;

    const paymentSummary: PaymentSummaryEntry[] = paymentGrouped
      .map((p) => ({
        method: p.paymentMethod,
        count: p._count._all,
        total: p._sum.grandTotal ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

    const expectedCash =
      shift.openingCash + totalCashSales + cashMovementIn - cashMovementOut;
    const cashDifference = dto.closingCash - expectedCash;
    const trimmedNotes = dto.notes?.trim() ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      // Update the shift snapshot.
      await tx.cashierShift.update({
        where: { id: shiftId },
        data: {
          closingCash: dto.closingCash,
          expectedCash,
          cashDifference,
          totalSales: totalCashSales,
          totalTransactions,
          ...(trimmedNotes !== null ? { notes: trimmedNotes } : {}),
        },
      });

      // Upsert the closing report and flag allowReopen so the cashier
      // can open a fresh shift.
      const existing = await tx.closingReport.findUnique({
        where: { shiftId },
        select: { id: true, notes: true },
      });

      const composedNotes = trimmedNotes
        ? existing?.notes
          ? `${existing.notes}\n[RECLOSED] ${trimmedNotes}`
          : `[RECLOSED] ${trimmedNotes}`
        : (existing?.notes ?? null);

      if (existing) {
        return tx.closingReport.update({
          where: { id: existing.id },
          data: {
            openingCash: shift.openingCash,
            closingCash: dto.closingCash,
            expectedCash,
            cashDifference,
            totalTransactions,
            totalSales,
            totalDiscount,
            totalTax,
            totalCashSales,
            totalNonCashSales,
            cashMovementIn,
            cashMovementOut,
            voidCount,
            refundCount,
            paymentSummary:
              paymentSummary.length > 0
                ? (paymentSummary as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            notes: composedNotes,
            allowReopen: true,
          },
          select: CLOSING_REPORT_SELECT,
        });
      }

      return tx.closingReport.create({
        data: {
          shiftId,
          cashierUserId: shift.userId,
          branchId: shift.branchId ?? null,
          companyId,
          cashierName: shift.user?.name ?? "",
          date: closedAt,
          openingCash: shift.openingCash,
          closingCash: dto.closingCash,
          expectedCash,
          cashDifference,
          totalTransactions,
          totalSales,
          totalDiscount,
          totalTax,
          totalCashSales,
          totalNonCashSales,
          cashMovementIn,
          cashMovementOut,
          voidCount,
          refundCount,
          paymentSummary:
            paymentSummary.length > 0
              ? (paymentSummary as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          notes: composedNotes,
          allowReopen: true,
        },
        select: CLOSING_REPORT_SELECT,
      });
    });

    return toClosingReportResponse(result);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.closingReport.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Closing report not found");
    await this.prisma.closingReport.delete({ where: { id } });
    return { success: true };
  }
}
