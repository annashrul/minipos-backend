import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// SELECT constants & Raw types
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_TARGET_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true, email: true, role: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  type: true,
  targetRevenue: true,
  targetTx: true,
  targetItems: true,
  period: true,
  isActive: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SalesTargetSelect;

export type RawSalesTarget = Prisma.SalesTargetGetPayload<{
  select: typeof SALES_TARGET_SELECT;
}>;

@Injectable()
export class SalesTargetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.SalesTargetWhereInput,
    skip: number,
    take: number,
  ): Promise<RawSalesTarget[]> {
    return this.prisma.salesTarget.findMany({
      where,
      select: SALES_TARGET_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.SalesTargetWhereInput): Promise<number> {
    return this.prisma.salesTarget.count({ where });
  }

  async findOne(
    where: Prisma.SalesTargetWhereInput,
  ): Promise<RawSalesTarget | null> {
    return this.prisma.salesTarget.findFirst({
      where,
      select: SALES_TARGET_SELECT,
    });
  }

  async findExistence(
    where: Prisma.SalesTargetWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.salesTarget.findFirst({
      where,
      select: { id: true },
    });
  }

  async findManyActive(
    where: Prisma.SalesTargetWhereInput,
  ): Promise<RawSalesTarget[]> {
    return this.prisma.salesTarget.findMany({
      where: { ...where, isActive: true },
      select: SALES_TARGET_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    data: Prisma.SalesTargetUncheckedCreateInput,
  ): Promise<RawSalesTarget> {
    return this.prisma.salesTarget.create({
      data,
      select: SALES_TARGET_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.SalesTargetUpdateInput,
  ): Promise<RawSalesTarget> {
    return this.prisma.salesTarget.update({
      where: { id },
      data,
      select: SALES_TARGET_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.salesTarget.delete({ where: { id } });
  }

  // ── Leaderboard queries ──────────────────────────────────────────────────

  async groupTransactionsByUser(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.groupBy({
      by: ["userId"],
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
  }

  async groupTransactionItemsByTransaction(
    where: Prisma.TransactionItemWhereInput,
  ) {
    return this.prisma.transactionItem.groupBy({
      by: ["transactionId"],
      where,
      _sum: { quantity: true },
    });
  }

  async findTransactionUsers(
    txIds: string[],
  ): Promise<{ id: string; userId: string }[]> {
    if (txIds.length === 0) return [];
    return this.prisma.transaction.findMany({
      where: { id: { in: txIds } },
      select: { id: true, userId: true },
    });
  }

  async findTargetsByPeriod(
    type: string,
    period: string,
  ): Promise<{ userId: string | null; targetRevenue: number | null }[]> {
    return this.prisma.salesTarget.findMany({
      where: { type, period, isActive: true },
      select: { userId: true, targetRevenue: true },
    });
  }

  async findBadgesByPeriod(
    period: string,
  ): Promise<{ userId: string; badge: string; title: string }[]> {
    return this.prisma.cashierBadge.findMany({
      where: { period },
      select: { userId: true, badge: true, title: true },
    });
  }

  async findUsersByIds(
    ids: string[],
  ): Promise<{ id: string; name: string }[]> {
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  // ── Badge queries ────────────────────────────────────────────────────────

  async findManyBadges(
    where: Prisma.CashierBadgeWhereInput,
  ) {
    return this.prisma.cashierBadge.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { earnedAt: "desc" },
    });
  }

  async findBadgeExistence(
    userId: string,
    badge: string,
    period: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.cashierBadge.findFirst({
      where: { userId, badge, period },
      select: { id: true },
    });
  }

  async createBadge(data: {
    userId: string;
    badge: string;
    title: string;
    description: string;
    period: string;
  }) {
    return this.prisma.cashierBadge.create({ data });
  }

  // ── Raw SQL queries (badge evaluation) ───────────────────────────────────

  async findEarlyBirdTop(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<{ userId: string; cnt: bigint }[]> {
    return this.prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
      SELECT t."userId", COUNT(*)::bigint as cnt
      FROM transactions t
      JOIN branches br ON br.id = t."branchId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= ${start} AND t."createdAt" <= ${end}
        AND br."companyId" = ${companyId}
        AND EXTRACT(HOUR FROM t."createdAt") < 10
      GROUP BY t."userId"
      ORDER BY cnt DESC
      LIMIT 1
    `.catch(() => [] as { userId: string; cnt: bigint }[]);
  }

  async findNightOwlTop(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<{ userId: string; cnt: bigint }[]> {
    return this.prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
      SELECT t."userId", COUNT(*)::bigint as cnt
      FROM transactions t
      JOIN branches br ON br.id = t."branchId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= ${start} AND t."createdAt" <= ${end}
        AND br."companyId" = ${companyId}
        AND EXTRACT(HOUR FROM t."createdAt") >= 20
      GROUP BY t."userId"
      ORDER BY cnt DESC
      LIMIT 1
    `.catch(() => [] as { userId: string; cnt: bigint }[]);
  }

  async findTeamPlayerTop(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<{ userId: string; branchCount: bigint }[]> {
    return this.prisma.$queryRaw<{ userId: string; branchCount: bigint }[]>`
      SELECT t."userId", COUNT(DISTINCT t."branchId")::bigint as "branchCount"
      FROM transactions t
      JOIN branches br ON br.id = t."branchId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= ${start} AND t."createdAt" <= ${end}
        AND br."companyId" = ${companyId}
        AND t."branchId" IS NOT NULL
      GROUP BY t."userId"
      ORDER BY "branchCount" DESC
      LIMIT 1
    `.catch(() => [] as { userId: string; branchCount: bigint }[]);
  }

  // ── Streak / daily targets ───────────────────────────────────────────────

  async findDailyTargets(
    companyId: string,
    periodFrom: string,
    periodTo: string,
  ) {
    return this.prisma.salesTarget.findMany({
      where: {
        type: "DAILY",
        isActive: true,
        period: { gte: periodFrom, lte: periodTo },
        userId: { not: null },
        user: { is: { companyId } },
      },
    });
  }

  async aggregateTransactionRevenue(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: { grandTotal: true },
    });
  }

  // ── Achievement computation ──────────────────────────────────────────────

  async aggregateTransactions(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.aggregate({
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
  }

  async aggregateTransactionItems(
    where: Prisma.TransactionItemWhereInput,
  ) {
    return this.prisma.transactionItem.aggregate({
      where,
      _sum: { quantity: true },
    });
  }

  // ── Reference validation ─────────────────────────────────────────────────

  async findUserInCompany(
    userId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true },
    });
  }

  async findBranchInCompany(
    branchId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }
}
