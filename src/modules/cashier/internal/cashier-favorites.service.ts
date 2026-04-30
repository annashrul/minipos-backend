import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CashierFavoriteResponse,
  CreateCashierFavoriteDto,
  ReorderCashierFavoritesDto,
  UpdateCashierFavoriteDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { FAVORITE_SELECT, toFavoriteResponse } from "./cashier.shared";

@Injectable()
export class CashierFavoritesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
