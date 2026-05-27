import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// SELECT constants & Raw types
// ─────────────────────────────────────────────────────────────────────────────

export const FAVORITE_SELECT = {
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

export type RawFavorite = Prisma.CashierFavoriteGetPayload<{
  select: typeof FAVORITE_SELECT;
}>;

export const BADGE_SELECT = {
  id: true,
  userId: true,
  badge: true,
  earnedAt: true,
} satisfies Prisma.CashierBadgeSelect;

export type RawBadge = Prisma.CashierBadgeGetPayload<{
  select: typeof BADGE_SELECT;
}>;

@Injectable()
export class CashierRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Favorites
  // ─────────────────────────────────────────────────────────────────────────

  async findManyFavorites(
    userId: string,
    companyId: string,
  ): Promise<RawFavorite[]> {
    return this.prisma.cashierFavorite.findMany({
      where: { userId, product: { companyId } },
      select: FAVORITE_SELECT,
      orderBy: { sortOrder: "asc" },
    });
  }

  async findProduct(
    productId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
  }

  async maxFavoriteSortOrder(userId: string): Promise<number> {
    const max = await this.prisma.cashierFavorite.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });
    return max._max.sortOrder ?? -1;
  }

  async createFavorite(data: {
    userId: string;
    productId: string;
    sortOrder: number;
  }): Promise<RawFavorite> {
    return this.prisma.cashierFavorite.create({
      data,
      select: FAVORITE_SELECT,
    });
  }

  async findOneFavorite(
    where: Prisma.CashierFavoriteWhereInput,
  ): Promise<{ id: string; userId?: string } | null> {
    return this.prisma.cashierFavorite.findFirst({
      where,
      select: { id: true, userId: true },
    });
  }

  async updateFavorite(
    id: string,
    data: { sortOrder: number },
  ): Promise<RawFavorite> {
    return this.prisma.cashierFavorite.update({
      where: { id },
      data,
      select: FAVORITE_SELECT,
    });
  }

  async findManyFavoriteIds(
    ids: string[],
    userId: string,
    companyId: string,
  ): Promise<{ id: string }[]> {
    return this.prisma.cashierFavorite.findMany({
      where: { id: { in: ids }, userId, product: { companyId } },
      select: { id: true },
    });
  }

  buildReorderUpdates(
    items: { id: string; sortOrder: number }[],
  ): Prisma.PrismaPromise<unknown>[] {
    return items.map((item) =>
      this.prisma.cashierFavorite.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      }),
    );
  }

  async deleteFavorite(id: string): Promise<void> {
    await this.prisma.cashierFavorite.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Badges
  // ─────────────────────────────────────────────────────────────────────────

  async findUser(
    userId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true },
    });
  }

  async findUserWithName(
    userId: string,
    companyId: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, name: true },
    });
  }

  async findManyBadges(userId: string): Promise<RawBadge[]> {
    return this.prisma.cashierBadge.findMany({
      where: { userId },
      select: BADGE_SELECT,
      orderBy: { earnedAt: "desc" },
    });
  }

  async findDuplicateBadge(
    userId: string,
    badge: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.cashierBadge.findFirst({
      where: { userId, badge },
      select: { id: true },
    });
  }

  async createBadge(data: {
    userId: string;
    badge: string;
    title: string;
  }): Promise<RawBadge> {
    return this.prisma.cashierBadge.create({
      data,
      select: BADGE_SELECT,
    });
  }

  async findOneBadge(
    id: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.cashierBadge.findFirst({
      where: { id, user: { companyId } },
      select: { id: true },
    });
  }

  async deleteBadge(id: string): Promise<void> {
    await this.prisma.cashierBadge.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Performance / Auto-award helpers
  // ─────────────────────────────────────────────────────────────────────────

  async findManyUsers(
    where: Prisma.UserWhereInput,
  ): Promise<{ id: string; name: string }[]> {
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
    });
  }

  async groupTransactions(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.groupBy({
      by: ["userId"],
      where,
      _sum: { grandTotal: true, discountAmount: true },
      _count: { _all: true },
    });
  }

  async groupTransactionsCountOnly(
    where: Prisma.TransactionWhereInput,
  ) {
    return this.prisma.transaction.groupBy({
      by: ["userId"],
      where,
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
  }

  async findManyShifts(where: Prisma.CashierShiftWhereInput) {
    return this.prisma.cashierShift.findMany({
      where,
      select: { userId: true, openedAt: true, closedAt: true },
    });
  }

  async findExistingBadges(
    userIds: string[],
  ): Promise<{ userId: string; badge: string }[]> {
    return this.prisma.cashierBadge.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, badge: true },
    });
  }
}
