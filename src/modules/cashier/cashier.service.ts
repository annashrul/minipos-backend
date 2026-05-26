import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AutoAwardBadgesResponse,
  CashierBadgeResponse,
  CashierFavoriteResponse,
  CashierPerformanceLeaderboardQueryDto,
  CashierPerformanceListResponse,
  CashierPerformanceQueryDto,
  CashierPerformanceResponse,
  CreateCashierBadgeDto,
  CreateCashierFavoriteDto,
  ReorderCashierFavoritesDto,
  UpdateCashierFavoriteDto,
} from "./dto/cashier.dto";
import { PrismaService } from "../prisma/prisma.service";

// We encode (badge, level) into the DB `badge` field using a separator,
// because the schema doesn't have a dedicated `level` column.
// Format: `${badgeKey}#${level}` (e.g. "TOP_SELLER#1", "VOLUME_KING#3").
const LEVEL_SEPARATOR = "#";

const FAVORITE_SELECT = {
  id: true,
  userId: true,
  productId: true,
  sortOrder: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      sellingPrice: true,
      imageUrl: true,
      companyId: true,
    },
  },
} satisfies Prisma.CashierFavoriteSelect;

type RawFavorite = Prisma.CashierFavoriteGetPayload<{
  select: typeof FAVORITE_SELECT;
}>;

const BADGE_SELECT = {
  id: true,
  userId: true,
  badge: true,
  earnedAt: true,
} satisfies Prisma.CashierBadgeSelect;

type RawBadge = Prisma.CashierBadgeGetPayload<{ select: typeof BADGE_SELECT }>;

type AutoAwardRule = {
  badge: string;
  level: number;
  threshold: number;
};

const TOP_SELLER_RULES: AutoAwardRule[] = [
  { badge: "TOP_SELLER", level: 1, threshold: 50_000_000 },
  { badge: "TOP_SELLER", level: 2, threshold: 100_000_000 },
  { badge: "TOP_SELLER", level: 3, threshold: 200_000_000 },
];

const VOLUME_KING_RULES: AutoAwardRule[] = [
  { badge: "VOLUME_KING", level: 1, threshold: 100 },
  { badge: "VOLUME_KING", level: 2, threshold: 300 },
  { badge: "VOLUME_KING", level: 3, threshold: 500 },
];

@Injectable()
export class CashierService {
  constructor(private readonly prisma: PrismaService) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Favorites
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async listFavorites(
    companyId: string,
    userId: string,
  ): Promise<CashierFavoriteResponse[]> {
    const rows = await this.prisma.cashierFavorite.findMany({
      where: {
        userId,
        product: { companyId },
      },
      select: FAVORITE_SELECT,
      orderBy: { sortOrder: "asc" },
    });
    return rows.map(toFavoriteResponse);
  }

  async createFavorite(
    companyId: string,
    userId: string,
    dto: CreateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException("Produk tidak ditemukan");
    }

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const max = await this.prisma.cashierFavorite.aggregate({
        where: { userId },
        _max: { sortOrder: true },
      });
      sortOrder = (max._max.sortOrder ?? -1) + 1;
    }

    try {
      const created = await this.prisma.cashierFavorite.create({
        data: {
          userId,
          productId: dto.productId,
          sortOrder,
        },
        select: FAVORITE_SELECT,
      });
      return toFavoriteResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Produk sudah ada di favorit");
      }
      throw err;
    }
  }

  async updateFavorite(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    const existing = await this.prisma.cashierFavorite.findFirst({
      where: { id, userId, product: { companyId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Favorit tidak ditemukan");

    const updated = await this.prisma.cashierFavorite.update({
      where: { id },
      data: { sortOrder: dto.sortOrder },
      select: FAVORITE_SELECT,
    });
    return toFavoriteResponse(updated);
  }

  async reorderFavorites(
    companyId: string,
    userId: string,
    dto: ReorderCashierFavoritesDto,
  ): Promise<CashierFavoriteResponse[]> {
    const ids = dto.items.map((i) => i.id);
    const owned = await this.prisma.cashierFavorite.findMany({
      where: { id: { in: ids }, userId, product: { companyId } },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new ForbiddenException(
        "Salah satu favorit bukan milik user atau perusahaan",
      );
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.cashierFavorite.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );

    return this.listFavorites(companyId, userId);
  }

  async deleteFavorite(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.cashierFavorite.findFirst({
      where: { id, product: { companyId } },
      select: { id: true, userId: true },
    });
    if (!existing) throw new NotFoundException("Favorit tidak ditemukan");
    if (existing.userId !== userId) {
      throw new ForbiddenException(
        "Hanya pemilik favorit yang dapat menghapus",
      );
    }
    await this.prisma.cashierFavorite.delete({ where: { id } });
    return { success: true };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Badges
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  async getPerformance(
    companyId: string,
    query: CashierPerformanceQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    const now = new Date();
    const defaultRange = monthRange(now);
    const from = query.from ? new Date(query.from) : defaultRange.start;
    const to = query.to ? new Date(query.to) : defaultRange.end;

    const performance = await this.computePerformance(companyId, from, to, {
      userId: query.userId,
      branchId: query.branchId,
    });

    return {
      performance,
      total: performance.length,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  async getLeaderboard(
    companyId: string,
    query: CashierPerformanceLeaderboardQueryDto,
  ): Promise<CashierPerformanceListResponse> {
    const { start, end } = periodRange(query.period, new Date());
    const performance = await this.computePerformance(companyId, start, end);
    const top = performance.slice(0, query.limit);

    return {
      performance: top,
      total: top.length,
      from: start.toISOString(),
      to: end.toISOString(),
    };
  }

  async getMyPerformance(
    companyId: string,
    userId: string,
  ): Promise<CashierPerformanceResponse | null> {
    const { start, end } = monthRange(new Date());
    const performance = await this.computePerformance(companyId, start, end, {
      userId,
    });
    return performance[0] ?? null;
  }

  private async computePerformance(
    companyId: string,
    from: Date,
    to: Date,
    filters: { userId?: string; branchId?: string } = {},
  ): Promise<CashierPerformanceResponse[]> {
    const userWhere: Prisma.UserWhereInput = { companyId };
    if (filters.userId) userWhere.id = filters.userId;
    if (filters.branchId) userWhere.branchId = filters.branchId;

    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true },
    });
    if (users.length === 0) return [];
    const userIds = users.map((u) => u.id);

    const txWhereBase: Prisma.TransactionWhereInput = {
      userId: { in: userIds },
      createdAt: { gte: from, lte: to },
    };
    if (filters.branchId) txWhereBase.branchId = filters.branchId;

    const completedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "COMPLETED",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...txWhereBase,
      status: "VOIDED",
    };

    const shiftWhere: Prisma.CashierShiftWhereInput = {
      userId: { in: userIds },
      isOpen: false,
      closedAt: { not: null, gte: from, lte: to },
      openedAt: { gte: from, lte: to },
    };
    if (filters.branchId) shiftWhere.branchId = filters.branchId;

    const [completedAgg, refundedAgg, voidedAgg, shifts] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: completedWhere,
        _sum: { grandTotal: true, discountAmount: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: refundedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ["userId"],
        where: voidedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.cashierShift.findMany({
        where: shiftWhere,
        select: { userId: true, openedAt: true, closedAt: true },
      }),
    ]);

    const salesMap = new Map<string, number>();
    const discountMap = new Map<string, number>();
    const txCountMap = new Map<string, number>();
    for (const row of completedAgg) {
      salesMap.set(row.userId, row._sum.grandTotal ?? 0);
      discountMap.set(row.userId, row._sum.discountAmount ?? 0);
      txCountMap.set(row.userId, row._count._all);
    }

    const refundMap = new Map<string, number>();
    for (const row of refundedAgg) {
      refundMap.set(row.userId, row._sum.grandTotal ?? 0);
    }

    const voidMap = new Map<string, number>();
    for (const row of voidedAgg) {
      voidMap.set(row.userId, row._sum.grandTotal ?? 0);
    }

    const hoursMap = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.closedAt) continue;
      const ms = shift.closedAt.getTime() - shift.openedAt.getTime();
      if (ms <= 0) continue;
      const hours = ms / (1000 * 60 * 60);
      hoursMap.set(shift.userId, (hoursMap.get(shift.userId) ?? 0) + hours);
    }

    const rows: CashierPerformanceResponse[] = users.map((user) => {
      const totalSales = salesMap.get(user.id) ?? 0;
      const totalTransactions = txCountMap.get(user.id) ?? 0;
      const hoursWorked = round2(hoursMap.get(user.id) ?? 0);
      return {
        userId: user.id,
        userName: user.name,
        totalSales,
        totalTransactions,
        avgTransaction:
          totalTransactions > 0 ? totalSales / totalTransactions : 0,
        totalDiscount: discountMap.get(user.id) ?? 0,
        totalRefund: refundMap.get(user.id) ?? 0,
        totalVoid: voidMap.get(user.id) ?? 0,
        hoursWorked,
        salesPerHour: hoursWorked > 0 ? totalSales / hoursWorked : 0,
        rankBySales: 0,
        rankByTransactions: 0,
      };
    });

    const bySales = [...rows].sort((a, b) => b.totalSales - a.totalSales);
    bySales.forEach((row, idx) => {
      row.rankBySales = idx + 1;
    });

    const byTx = [...rows].sort(
      (a, b) => b.totalTransactions - a.totalTransactions,
    );
    byTx.forEach((row, idx) => {
      row.rankByTransactions = idx + 1;
    });

    return bySales;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function toFavoriteResponse(f: RawFavorite): CashierFavoriteResponse {
  return {
    id: f.id,
    userId: f.userId,
    productId: f.productId,
    sortOrder: f.sortOrder,
    product: {
      id: f.product.id,
      code: f.product.code,
      name: f.product.name,
      sellingPrice: f.product.sellingPrice,
      imageUrl: f.product.imageUrl,
    },
    createdAt: f.createdAt.toISOString(),
  };
}

function toBadgeResponse(b: RawBadge): CashierBadgeResponse {
  const { badge, level } = decodeBadge(b.badge);
  return {
    id: b.id,
    userId: b.userId,
    badge,
    level,
    earnedAt: b.earnedAt.toISOString(),
  };
}

function encodeBadge(badge: string, level: number): string {
  return `${badge}${LEVEL_SEPARATOR}${level}`;
}

function decodeBadge(stored: string): { badge: string; level: number } {
  const idx = stored.lastIndexOf(LEVEL_SEPARATOR);
  if (idx === -1) {
    return { badge: stored, level: 1 };
  }
  const badge = stored.slice(0, idx);
  const levelRaw = stored.slice(idx + 1);
  const level = Number.parseInt(levelRaw, 10);
  if (!Number.isFinite(level) || level < 1) {
    return { badge: stored, level: 1 };
  }
  return { badge, level };
}

function makeBadgeTitle(badge: string, level: number): string {
  return `${badge} L${level}`;
}

function monthRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

function periodRange(
  period: "today" | "week" | "month" | "year",
  now: Date,
): { start: Date; end: Date } {
  if (period === "today") {
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );
    return { start, end };
  }
  if (period === "week") {
    const dayOfWeek = now.getDay() || 7; // Mon=1..Sun=7
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (dayOfWeek - 1),
      0,
      0,
      0,
      0,
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
      23,
      59,
      59,
      999,
    );
    return { start: monday, end: sunday };
  }
  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end };
  }
  return monthRange(now);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
