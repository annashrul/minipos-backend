import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import { round2 } from "@/common/utils/math";
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
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  CashierRepository,
  type RawFavorite,
  type RawBadge,
} from "./cashier.repository";

// We encode (badge, level) into the DB `badge` field using a separator,
// because the schema doesn't have a dedicated `level` column.
// Format: `${badgeKey}#${level}` (e.g. "TOP_SELLER#1", "VOLUME_KING#3").
const LEVEL_SEPARATOR = "#";

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
  constructor(
    private readonly repo: CashierRepository,
    private readonly prisma: PrismaService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Favorites
  // ─────────────────────────────────────────────────────────────────────────────

  async listFavorites(
    companyId: string,
    userId: string,
  ): Promise<CashierFavoriteResponse[]> {
    const rows = await this.repo.findManyFavorites(userId, companyId);
    return rows.map(toFavoriteResponse);
  }

  async createFavorite(
    companyId: string,
    userId: string,
    dto: CreateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    const product = await this.repo.findProduct(dto.productId, companyId);
    if (!product) {
      throw new NotFoundException("Produk tidak ditemukan");
    }

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const max = await this.repo.maxFavoriteSortOrder(userId);
      sortOrder = max + 1;
    }

    try {
      const created = await this.repo.createFavorite({
        userId,
        productId: dto.productId,
        sortOrder,
      });
      return toFavoriteResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Produk sudah ada di favorit");
    }
  }

  async updateFavorite(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateCashierFavoriteDto,
  ): Promise<CashierFavoriteResponse> {
    const existing = await this.repo.findOneFavorite({
      id,
      userId,
      product: { companyId },
    });
    if (!existing) throw new NotFoundException("Favorit tidak ditemukan");

    const updated = await this.repo.updateFavorite(id, {
      sortOrder: dto.sortOrder,
    });
    return toFavoriteResponse(updated);
  }

  async reorderFavorites(
    companyId: string,
    userId: string,
    dto: ReorderCashierFavoritesDto,
  ): Promise<CashierFavoriteResponse[]> {
    const ids = dto.items.map((i) => i.id);
    const owned = await this.repo.findManyFavoriteIds(ids, userId, companyId);
    if (owned.length !== ids.length) {
      throw new ForbiddenException(
        "Salah satu favorit bukan milik user atau perusahaan",
      );
    }

    await this.prisma.$transaction(this.repo.buildReorderUpdates(dto.items));

    return this.listFavorites(companyId, userId);
  }

  async deleteFavorite(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findOneFavorite({
      id,
      product: { companyId },
    });
    if (!existing) throw new NotFoundException("Favorit tidak ditemukan");
    if (existing.userId !== userId) {
      throw new ForbiddenException(
        "Hanya pemilik favorit yang dapat menghapus",
      );
    }
    await this.repo.deleteFavorite(id);
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Badges
  // ─────────────────────────────────────────────────────────────────────────────

  async listBadges(
    companyId: string,
    userId: string,
  ): Promise<CashierBadgeResponse[]> {
    const user = await this.repo.findUser(userId, companyId);
    if (!user) throw new NotFoundException("User tidak ditemukan");

    const rows = await this.repo.findManyBadges(userId);
    return rows.map(toBadgeResponse);
  }

  async createBadge(
    companyId: string,
    dto: CreateCashierBadgeDto,
  ): Promise<CashierBadgeResponse> {
    const user = await this.repo.findUserWithName(dto.userId, companyId);
    if (!user) throw new NotFoundException("User tidak ditemukan");

    const encoded = encodeBadge(dto.badge, dto.level);
    const duplicate = await this.repo.findDuplicateBadge(dto.userId, encoded);
    if (duplicate) {
      throw new ConflictException("Badge sudah dimiliki user");
    }

    try {
      const created = await this.repo.createBadge({
        userId: dto.userId,
        badge: encoded,
        title: makeBadgeTitle(dto.badge, dto.level),
      });
      return toBadgeResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Badge sudah dimiliki user");
    }
  }

  async deleteBadge(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findOneBadge(id, companyId);
    if (!existing) throw new NotFoundException("Badge tidak ditemukan");
    await this.repo.deleteBadge(id);
    return { success: true };
  }

  async autoAwardBadges(
    companyId: string,
    userId?: string,
  ): Promise<AutoAwardBadgesResponse> {
    const { start, end } = monthRange(new Date());

    const userWhere: Prisma.UserWhereInput = { companyId };
    if (userId) userWhere.id = userId;

    const users = await this.repo.findManyUsers(userWhere);
    if (users.length === 0) {
      return { awarded: 0, badges: [] };
    }

    const userIds = users.map((u) => u.id);

    const completedAgg = await this.repo.groupTransactions({
      userId: { in: userIds },
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
    });

    const salesByUser = new Map<string, number>();
    const txCountByUser = new Map<string, number>();
    for (const row of completedAgg) {
      salesByUser.set(row.userId, row._sum.grandTotal ?? 0);
      txCountByUser.set(row.userId, row._count._all);
    }

    const existing = await this.repo.findExistingBadges(userIds);
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
      const created = await this.repo.createBadge({
        userId,
        badge: encoded,
        title: makeBadgeTitle(badgeKey, level),
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Performance
  // ─────────────────────────────────────────────────────────────────────────────

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

    const users = await this.repo.findManyUsers(userWhere);
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
      this.repo.groupTransactions(completedWhere),
      this.repo.groupTransactionsCountOnly(refundedWhere),
      this.repo.groupTransactionsCountOnly(voidedWhere),
      this.repo.findManyShifts(shiftWhere),
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
