import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClosingReportListResponse,
  ClosingReportResponse,
  ListClosingReportsQueryDto,
  PaymentSummaryEntry,
  RecloseShiftDto,
  UpdateClosingReportDto,
} from "./dto/closing-reports.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { paginate } from "@/common/utils/pagination";
import { tenantWhere } from "@/common/utils/tenant";
import {
  ClosingReportsRepository,
  type RawClosingReport,
} from "./closing-reports.repository";

@Injectable()
export class ClosingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ClosingReportsRepository,
  ) {}

  async list(
    companyId: string,
    query: ListClosingReportsQueryDto,
  ): Promise<ClosingReportListResponse> {
    const { search, branchId, cashierUserId, from, to, page, perPage } = query;

    const where: Prisma.ClosingReportWhereInput = tenantWhere(companyId, "direct", "branch");
    if (branchId) where.branchId = branchId;
    if (cashierUserId) where.cashierUserId = cashierUserId;
    if (search) {
      where.cashierName = { contains: search, mode: "insensitive" };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toClosingReportResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ClosingReportResponse> {
    const report = await this.repo.findOne({
      id,
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!report) throw new NotFoundException("Laporan penutupan tidak ditemukan");
    return toClosingReportResponse(report);
  }

  async findByShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse | null> {
    const report = await this.repo.findOne({
      shiftId,
      ...tenantWhere(companyId, "direct", "branch"),
    });
    return report ? toClosingReportResponse(report) : null;
  }

  async createFromShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse> {
    const shift = await this.repo.findShift({
      id: shiftId,
      user: { companyId },
    });
    if (!shift) throw new NotFoundException("Shift tidak ditemukan");
    if (shift.isOpen) {
      throw new BadRequestException(
        "Shift masih terbuka, tutup terlebih dahulu sebelum membuat closing report",
      );
    }
    if (!shift.closedAt) {
      throw new BadRequestException("Shift belum memiliki waktu penutupan");
    }

    const existing = await this.repo.findByShiftId(shiftId);
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

      const cashMovementMap = new Map(
        cashMovementsGrouped.map((m) => [m.type, m._sum.amount ?? 0]),
      );
      const cashMovementIn = cashMovementMap.get("CASH_IN") ?? 0;
      const cashMovementOut = cashMovementMap.get("CASH_OUT") ?? 0;

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
        select: {
          id: true,
          shiftId: true,
          cashierUserId: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          companyId: true,
          cashierName: true,
          date: true,
          openingCash: true,
          closingCash: true,
          expectedCash: true,
          cashDifference: true,
          totalTransactions: true,
          totalSales: true,
          totalDiscount: true,
          totalTax: true,
          totalCashSales: true,
          totalNonCashSales: true,
          cashMovementIn: true,
          cashMovementOut: true,
          voidCount: true,
          refundCount: true,
          paymentSummary: true,
          notes: true,
          allowReopen: true,
          createdAt: true,
          shift: {
            select: {
              id: true,
              openedAt: true,
              closedAt: true,
            },
          },
        },
      });
    });

    return toClosingReportResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateClosingReportDto,
  ): Promise<ClosingReportResponse> {
    const existing = await this.repo.findById({
      id,
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!existing) throw new NotFoundException("Laporan penutupan tidak ditemukan");

    const data: Prisma.ClosingReportUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.repo.update(id, data);
    return toClosingReportResponse(updated);
  }

  async recloseShift(
    companyId: string,
    shiftId: string,
    dto: RecloseShiftDto,
  ): Promise<ClosingReportResponse> {
    const shift = await this.repo.findShiftForReclose({
      id: shiftId,
      user: { companyId },
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
      this.repo.aggregateTransactions(completedWhere),
      this.repo.aggregateTransactionsSum(cashCompletedWhere),
      this.repo.aggregateTransactionsCount(refundedWhere),
      this.repo.aggregateTransactionsCount(voidedWhere),
      this.repo.groupCashMovements(shiftId),
      this.repo.groupPaymentMethods(completedWhere),
    ]);

    const totalSales = completedAgg._sum.grandTotal ?? 0;
    const totalDiscount = completedAgg._sum.discountAmount ?? 0;
    const totalTax = completedAgg._sum.taxAmount ?? 0;
    const totalTransactions = completedAgg._count._all;
    const totalCashSales = cashAgg._sum.grandTotal ?? 0;
    const totalNonCashSales = totalSales - totalCashSales;
    const refundCount = refundedAgg._count._all;
    const voidCount = voidedAgg._count._all;

    const cashMovementMap = new Map(
      cashMovementsGrouped.map((m) => [m.type, m._sum.amount ?? 0]),
    );
    const cashMovementIn = cashMovementMap.get("CASH_IN") ?? 0;
    const cashMovementOut = cashMovementMap.get("CASH_OUT") ?? 0;

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
          select: {
            id: true,
            shiftId: true,
            cashierUserId: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
            companyId: true,
            cashierName: true,
            date: true,
            openingCash: true,
            closingCash: true,
            expectedCash: true,
            cashDifference: true,
            totalTransactions: true,
            totalSales: true,
            totalDiscount: true,
            totalTax: true,
            totalCashSales: true,
            totalNonCashSales: true,
            cashMovementIn: true,
            cashMovementOut: true,
            voidCount: true,
            refundCount: true,
            paymentSummary: true,
            notes: true,
            allowReopen: true,
            createdAt: true,
            shift: {
              select: {
                id: true,
                openedAt: true,
                closedAt: true,
              },
            },
          },
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
        select: {
          id: true,
          shiftId: true,
          cashierUserId: true,
          branchId: true,
          branch: { select: { id: true, name: true } },
          companyId: true,
          cashierName: true,
          date: true,
          openingCash: true,
          closingCash: true,
          expectedCash: true,
          cashDifference: true,
          totalTransactions: true,
          totalSales: true,
          totalDiscount: true,
          totalTax: true,
          totalCashSales: true,
          totalNonCashSales: true,
          cashMovementIn: true,
          cashMovementOut: true,
          voidCount: true,
          refundCount: true,
          paymentSummary: true,
          notes: true,
          allowReopen: true,
          createdAt: true,
          shift: {
            select: {
              id: true,
              openedAt: true,
              closedAt: true,
            },
          },
        },
      });
    });

    return toClosingReportResponse(result);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById({
      id,
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!existing) throw new NotFoundException("Laporan penutupan tidak ditemukan");
    await this.repo.delete(id);
    return { success: true };
  }

}

function toClosingReportResponse(r: RawClosingReport): ClosingReportResponse {
  const paymentSummary = parsePaymentSummary(r.paymentSummary);
  return {
    id: r.id,
    shiftId: r.shiftId,
    cashierUserId: r.cashierUserId,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    companyId: r.companyId,
    cashierName: r.cashierName,
    date: r.date.toISOString(),
    openedAt: r.shift?.openedAt ? r.shift.openedAt.toISOString() : null,
    closedAt: r.shift?.closedAt ? r.shift.closedAt.toISOString() : null,
    openingCash: r.openingCash,
    closingCash: r.closingCash,
    expectedCash: r.expectedCash,
    cashDifference: r.cashDifference,
    totalTransactions: r.totalTransactions,
    totalSales: r.totalSales,
    totalDiscount: r.totalDiscount,
    totalTax: r.totalTax,
    totalCashSales: r.totalCashSales,
    totalNonCashSales: r.totalNonCashSales,
    cashMovementIn: r.cashMovementIn,
    cashMovementOut: r.cashMovementOut,
    voidCount: r.voidCount,
    refundCount: r.refundCount,
    paymentSummary,
    notes: r.notes,
    allowReopen: r.allowReopen,
    createdAt: r.createdAt.toISOString(),
  };
}

function parsePaymentSummary(
  value: Prisma.JsonValue | null,
): PaymentSummaryEntry[] | null {
  if (!value || !Array.isArray(value)) return null;
  const result: PaymentSummaryEntry[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).method === "string" &&
      typeof (item as Record<string, unknown>).count === "number" &&
      typeof (item as Record<string, unknown>).total === "number"
    ) {
      const obj = item as Record<string, unknown>;
      result.push({
        method: obj.method as string,
        count: obj.count as number,
        total: obj.total as number,
      });
    }
  }
  return result;
}
