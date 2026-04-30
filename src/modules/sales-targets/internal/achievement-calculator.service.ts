import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateSalesTargetDto,
  SalesTargetResponse,
  SalesTargetStatusDto,
  UpdateSalesTargetDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { getPeriodRange, RawSalesTarget } from "./sales-targets.shared";

@Injectable()
export class AchievementCalculator {
  constructor(private readonly prisma: PrismaService) {}

  async compute(
    companyId: string,
    userId: string | null,
    branchId: string | null,
    start: Date,
    end: Date,
  ): Promise<{ revenue: number; tx: number; items: number }> {
    const txWhere: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
      branch: { is: { companyId } },
    };
    if (userId) txWhere.userId = userId;
    if (branchId) txWhere.branchId = branchId;

    const [agg, itemsAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: txWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transactionItem.aggregate({
        where: { transaction: { is: txWhere } },
        _sum: { quantity: true },
      }),
    ]);

    return {
      revenue: agg._sum.grandTotal ?? 0,
      tx: agg._count._all ?? 0,
      items: itemsAgg._sum.quantity ?? 0,
    };
  }

  async toResponse(
    t: RawSalesTarget,
    achievedHint?: { revenue: number; tx: number; items: number },
  ): Promise<SalesTargetResponse> {
    const { start, end } = getPeriodRange(t.type, t.period);
    let achieved = achievedHint;
    if (!achieved) {
      const txWhere: Prisma.TransactionWhereInput = {
        status: "COMPLETED",
        createdAt: { gte: start, lte: end },
      };
      if (t.userId) txWhere.userId = t.userId;
      if (t.branchId) txWhere.branchId = t.branchId;

      const agg = await this.prisma.transaction.aggregate({
        where: txWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      });
      achieved = {
        revenue: agg._sum.grandTotal ?? 0,
        tx: agg._count._all ?? 0,
        items: 0,
      };
    }

    const now = new Date();
    const targetRev = t.targetRevenue ?? 0;
    let status: SalesTargetStatusDto = "ACTIVE";
    if (targetRev > 0 && achieved.revenue >= targetRev) status = "COMPLETED";
    else if (now > end) status = "FAILED";

    return {
      id: t.id,
      name: null,
      type: t.type,
      branchId: t.branchId,
      branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
      userId: t.userId,
      user: t.user
        ? {
            id: t.user.id,
            name: t.user.name,
            email: t.user.email,
            role: t.user.role,
          }
        : null,
      targetRevenue: t.targetRevenue,
      targetTx: t.targetTx,
      targetItems: t.targetItems,
      period: t.period,
      isActive: t.isActive,
      achievedAmount: achieved.revenue,
      achievedTx: achieved.tx,
      achievedItems: achieved.items,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async assertReferences(
    companyId: string,
    dto: CreateSalesTargetDto | UpdateSalesTargetDto,
  ): Promise<void> {
    if (dto.userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.userId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw new NotFoundException("User not found");
    }
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }
  }
}
