import { Injectable } from "@nestjs/common";
import type {
  NotificationExpiringListResponse,
  NotificationLowStockListResponse,
} from "./dto/notifications.dto";
import { PrismaService } from "../prisma/prisma.service";

/**
 * NOTE: this module currently only exposes product-alert-style notifications
 * (low stock, expiring). A user-facing `Notification` table does not exist
 * in the Prisma schema yet, so list/markRead/create endpoints for general
 * notifications are intentionally not implemented here. Add them once the
 * schema gains a `Notification` model.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLowStockProducts(
    companyId: string,
  ): Promise<NotificationLowStockListResponse> {
    // Prisma cannot directly compare `stock <= minStock`, so we fetch a
    // small candidate set and filter in memory. Mirrors the original raw SQL
    // behaviour (active products, ordered by stock asc, capped at 20).
    const candidates = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        minStock: true,
      },
      orderBy: { stock: "asc" },
      take: 100,
    });

    return candidates
      .filter((p) => p.stock <= p.minStock)
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        stock: p.stock,
        minStock: p.minStock,
      }));
  }

  async getExpiringProducts(
    companyId: string,
  ): Promise<NotificationExpiringListResponse> {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const rows = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
        expiryDate: { not: null, lte: thirtyDaysFromNow },
      },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        expiryDate: true,
      },
      orderBy: { expiryDate: "asc" },
      take: 20,
    });

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
    }));
  }
}
