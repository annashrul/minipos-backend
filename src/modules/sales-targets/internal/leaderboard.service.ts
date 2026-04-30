import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  LeaderboardEntryDto,
  LeaderboardQueryDto,
  LeaderboardResponse,
  SalesTargetTypeDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { getCurrentPeriod, getPeriodRange } from "./sales-targets.shared";

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async leaderboard(
    companyId: string,
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    const type: SalesTargetTypeDto = query.type ?? "MONTHLY";
    const period = query.period ?? getCurrentPeriod(type);
    const { start, end } = getPeriodRange(type, period);

    const txWhere: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
      branch: { is: { companyId } },
    };
    if (query.branchId) txWhere.branchId = query.branchId;

    const [salesAgg, itemsRaw, targets, badges] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: txWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transactionItem.groupBy({
        by: ["transactionId"],
        where: { transaction: { is: txWhere } },
        _sum: { quantity: true },
      }),
      this.prisma.salesTarget.findMany({
        where: { type, period, isActive: true },
        select: { userId: true, targetRevenue: true },
      }),
      this.prisma.cashierBadge.findMany({
        where: { period },
        select: { userId: true, badge: true, title: true },
      }),
    ]);

    const txIds = itemsRaw.map((i) => i.transactionId);
    const txUsers =
      txIds.length > 0
        ? await this.prisma.transaction.findMany({
            where: { id: { in: txIds } },
            select: { id: true, userId: true },
          })
        : [];
    const txUserMap = new Map(txUsers.map((t) => [t.id, t.userId]));
    const itemsMap = new Map<string, number>();
    for (const row of itemsRaw) {
      const userId = txUserMap.get(row.transactionId);
      if (!userId) continue;
      itemsMap.set(
        userId,
        (itemsMap.get(userId) ?? 0) + (row._sum.quantity ?? 0),
      );
    }

    const targetMap = new Map<string, number>();
    for (const t of targets) {
      if (t.userId && t.targetRevenue) targetMap.set(t.userId, t.targetRevenue);
    }

    const badgesMap = new Map<string, { badge: string; title: string }[]>();
    for (const b of badges) {
      if (!badgesMap.has(b.userId)) badgesMap.set(b.userId, []);
      badgesMap.get(b.userId)!.push({ badge: b.badge, title: b.title });
    }

    const userIds = salesAgg.map((s) => s.userId).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    let leaderboard: LeaderboardEntryDto[] = salesAgg
      .map((s) => {
        if (!s.userId) return null;
        const user = userMap.get(s.userId);
        if (!user) return null;
        const revenue = s._sum.grandTotal ?? 0;
        const target = targetMap.get(s.userId) ?? 0;
        const percentage = target > 0 ? Math.round((revenue / target) * 100) : 0;
        return {
          rank: 0,
          userId: s.userId,
          name: user.name,
          avatarInitial: user.name.charAt(0).toUpperCase(),
          revenue,
          target,
          percentage,
          transactions: s._count._all,
          itemsSold: itemsMap.get(s.userId) ?? 0,
          badges: badgesMap.get(s.userId) ?? [],
        };
      })
      .filter(Boolean) as LeaderboardEntryDto[];

    leaderboard.sort((a, b) => b.revenue - a.revenue);
    leaderboard.forEach((entry, i) => {
      entry.rank = i + 1;
    });
    if (query.limit && query.limit > 0) {
      leaderboard = leaderboard.slice(0, query.limit);
    }

    return { leaderboard, period, type };
  }
}
