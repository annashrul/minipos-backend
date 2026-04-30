import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AutoAwardBadgesResponse,
  CashierBadgeResponse,
  CreateCashierBadgeDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AutoAwardRule,
  BADGE_SELECT,
  decodeBadge,
  encodeBadge,
  makeBadgeTitle,
  monthRange,
  TOP_SELLER_RULES,
  toBadgeResponse,
  VOLUME_KING_RULES,
} from "./cashier.shared";

@Injectable()
export class CashierBadgesService {
  constructor(private readonly prisma: PrismaService) {}

  async listBadges(
    companyId: string,
    userId: string,
  ): Promise<CashierBadgeResponse[]> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan");

    const rows = await this.prisma.cashierBadge.findMany({
      where: { userId },
      select: BADGE_SELECT,
      orderBy: { earnedAt: "desc" },
    });
    return rows.map(toBadgeResponse);
  }

  async createBadge(
    companyId: string,
    dto: CreateCashierBadgeDto,
  ): Promise<CashierBadgeResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException("User tidak ditemukan");

    const encoded = encodeBadge(dto.badge, dto.level);
    const duplicate = await this.prisma.cashierBadge.findFirst({
      where: { userId: dto.userId, badge: encoded },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException("Badge sudah dimiliki user");
    }

    try {
      const created = await this.prisma.cashierBadge.create({
        data: {
          userId: dto.userId,
          badge: encoded,
          title: makeBadgeTitle(dto.badge, dto.level),
        },
        select: BADGE_SELECT,
      });
      return toBadgeResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Badge sudah dimiliki user");
      }
      throw err;
    }
  }

  async deleteBadge(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.cashierBadge.findFirst({
      where: { id, user: { companyId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Badge tidak ditemukan");
    await this.prisma.cashierBadge.delete({ where: { id } });
    return { success: true };
  }

  async autoAwardBadges(
    companyId: string,
    userId?: string,
  ): Promise<AutoAwardBadgesResponse> {
    const { start, end } = monthRange(new Date());

    const userWhere: Prisma.UserWhereInput = { companyId };
    if (userId) userWhere.id = userId;

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true },
    });
    if (users.length === 0) {
      return { awarded: 0, badges: [] };
    }

    const userIds = users.map((u) => u.id);

    const completedAgg = await this.prisma.transaction.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        status: "COMPLETED",
        createdAt: { gte: start, lte: end },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    });

    const salesByUser = new Map<string, number>();
    const txCountByUser = new Map<string, number>();
    for (const row of completedAgg) {
      salesByUser.set(row.userId, row._sum.grandTotal ?? 0);
      txCountByUser.set(row.userId, row._count._all);
    }

    const existing = await this.prisma.cashierBadge.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, badge: true },
    });
    const ownedKeys = new Set(
      existing.map((b) => `${b.userId}|${b.badge}`),
    );

    const awarded: CashierBadgeResponse[] = [];

    for (const user of users) {
      const totalSales = salesByUser.get(user.id) ?? 0;
      const totalTx = txCountByUser.get(user.id) ?? 0;

      for (const rule of TOP_SELLER_RULES) {
        if (totalSales < rule.threshold) continue;
        const created = await this.maybeAwardBadge(
          user.id,
          rule.badge,
          rule.level,
          ownedKeys,
        );
        if (created) awarded.push(created);
      }

      for (const rule of VOLUME_KING_RULES) {
        if (totalTx < rule.threshold) continue;
        const created = await this.maybeAwardBadge(
          user.id,
          rule.badge,
          rule.level,
          ownedKeys,
        );
        if (created) awarded.push(created);
      }
    }

    return { awarded: awarded.length, badges: awarded };
  }

  private async maybeAwardBadge(
    userId: string,
    badgeKey: string,
    level: number,
    ownedKeys: Set<string>,
  ): Promise<CashierBadgeResponse | null> {
    const encoded = encodeBadge(badgeKey, level);
    const dedupKey = `${userId}|${encoded}`;
    if (ownedKeys.has(dedupKey)) return null;

    try {
      const created = await this.prisma.cashierBadge.create({
        data: {
          userId,
          badge: encoded,
          title: makeBadgeTitle(badgeKey, level),
        },
        select: BADGE_SELECT,
      });
      ownedKeys.add(dedupKey);
      return toBadgeResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        ownedKeys.add(dedupKey);
        return null;
      }
      throw err;
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Performance
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
}
