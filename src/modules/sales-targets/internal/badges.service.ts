import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  EvaluateBadgesDto,
  EvaluateBadgesResponse,
  GetSalesBadgesQueryDto,
  SalesBadgeResponse,
  SalesTargetTypeDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  BADGE_DEFINITIONS,
  getCurrentPeriod,
  getPeriodRange,
} from "./sales-targets.shared";

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  async listBadges(
    companyId: string,
    query: GetSalesBadgesQueryDto,
  ): Promise<SalesBadgeResponse[]> {
    const where: Prisma.CashierBadgeWhereInput = {
      user: { is: { companyId } },
    };
    if (query.userId) where.userId = query.userId;

    const rows = await this.prisma.cashierBadge.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { earnedAt: "desc" },
    });

    return rows.map((b) => ({
      id: b.id,
      userId: b.userId,
      badge: b.badge,
      title: b.title,
      description: b.description ?? null,
      period: b.period ?? null,
      earnedAt: b.earnedAt.toISOString(),
      user: b.user ? { id: b.user.id, name: b.user.name } : null,
    }));
  }

  async evaluateAndAwardBadges(
    companyId: string,
    body: EvaluateBadgesDto,
  ): Promise<EvaluateBadgesResponse> {
    const type: SalesTargetTypeDto = "MONTHLY";
    const currentPeriod = body.period ?? getCurrentPeriod(type);
    const { start, end } = getPeriodRange(type, currentPeriod);

    const tenantTx: Prisma.TransactionWhereInput = {
      branch: { is: { companyId } },
    };
    const txWhere: Prisma.TransactionWhereInput = {
      ...tenantTx,
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
    };

    const [salesAgg, voidAgg, targets, earlyBirdAgg, nightOwlAgg, branchAgg] =
      await Promise.all([
        this.prisma.transaction.groupBy({
          by: ["userId"],
          where: txWhere,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.groupBy({
          by: ["userId"],
          where: {
            ...tenantTx,
            status: "VOIDED",
            createdAt: { gte: start, lte: end },
          },
          _count: { _all: true },
        }),
        this.prisma.salesTarget.findMany({
          where: { type, period: currentPeriod, isActive: true },
        }),
        this.prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
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
        `.catch(() => [] as { userId: string; cnt: bigint }[]),
        this.prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
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
        `.catch(() => [] as { userId: string; cnt: bigint }[]),
        this.prisma.$queryRaw<{ userId: string; branchCount: bigint }[]>`
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
        `.catch(() => [] as { userId: string; branchCount: bigint }[]),
      ]);

    const awarded: { userId: string; badge: string; title: string }[] = [];
    const award = async (userId: string, badgeKey: string): Promise<void> => {
      const def = BADGE_DEFINITIONS.find((b) => b.key === badgeKey);
      if (!def) return;
      const exists = await this.prisma.cashierBadge.findFirst({
        where: { userId, badge: badgeKey, period: currentPeriod },
      });
      if (exists) return;
      await this.prisma.cashierBadge.create({
        data: {
          userId,
          badge: badgeKey,
          title: def.title,
          description: def.description,
          period: currentPeriod,
        },
      });
      awarded.push({ userId, badge: badgeKey, title: def.title });
    };

    const voidMap = new Map(
      voidAgg.map((v) => [v.userId, v._count._all] as const),
    );
    const targetMap = new Map(targets.map((t) => [t.userId, t] as const));

    const sortedByRevenue = [...salesAgg].sort(
      (a, b) => (b._sum.grandTotal ?? 0) - (a._sum.grandTotal ?? 0),
    );
    const topSeller = sortedByRevenue[0];
    if (topSeller?.userId) await award(topSeller.userId, "TOP_SELLER");

    const sortedByTx = [...salesAgg].sort(
      (a, b) => b._count._all - a._count._all,
    );
    const speedDemon = sortedByTx[0];
    if (speedDemon?.userId) await award(speedDemon.userId, "SPEED_DEMON");

    for (const s of salesAgg) {
      if (!s.userId) continue;
      const voidCount = voidMap.get(s.userId) ?? 0;
      if (voidCount === 0) await award(s.userId, "ZERO_VOID");

      const target = targetMap.get(s.userId);
      if (
        target?.targetRevenue &&
        (s._sum.grandTotal ?? 0) >= target.targetRevenue * 1.2
      ) {
        await award(s.userId, "TARGET_CRUSHER");
      }
    }

    const earlyBird = earlyBirdAgg[0];
    if (earlyBird && Number(earlyBird.cnt) > 0) {
      await award(earlyBird.userId, "EARLY_BIRD");
    }
    const nightOwl = nightOwlAgg[0];
    if (nightOwl && Number(nightOwl.cnt) > 0) {
      await award(nightOwl.userId, "NIGHT_OWL");
    }
    const teamPlayer = branchAgg[0];
    if (teamPlayer && Number(teamPlayer.branchCount) > 1) {
      await award(teamPlayer.userId, "TEAM_PLAYER");
    }

    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const dailyTargets = await this.prisma.salesTarget.findMany({
      where: {
        type: "DAILY",
        isActive: true,
        period: {
          gte: sevenDaysAgo.toISOString().slice(0, 10),
          lte: today.toISOString().slice(0, 10),
        },
        userId: { not: null },
        user: { is: { companyId } },
      },
    });

    const userDailyTargets = new Map<string, typeof dailyTargets>();
    for (const dt of dailyTargets) {
      if (!dt.userId) continue;
      if (!userDailyTargets.has(dt.userId)) userDailyTargets.set(dt.userId, []);
      userDailyTargets.get(dt.userId)!.push(dt);
    }

    for (const [userId, dts] of userDailyTargets) {
      if (dts.length < 7) continue;
      let streakCount = 0;
      for (const dt of dts) {
        const dayRange = getPeriodRange("DAILY", dt.period);
        const daySales = await this.prisma.transaction.aggregate({
          where: {
            userId,
            status: "COMPLETED",
            createdAt: { gte: dayRange.start, lte: dayRange.end },
          },
          _sum: { grandTotal: true },
        });
        if (
          dt.targetRevenue &&
          (daySales._sum.grandTotal ?? 0) >= dt.targetRevenue
        ) {
          streakCount++;
        }
      }
      if (streakCount >= 7) await award(userId, "STREAK_7");
    }

    return { awarded, period: currentPeriod };
  }
}
