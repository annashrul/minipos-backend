import { Injectable } from "@nestjs/common";
import type {
  NotificationExpiringListResponse,
  NotificationLowStockListResponse,
} from "./dto/notifications.dto";
import { NotificationsRepository } from "./notifications.repository";

/**
 * NOTE: this module currently only exposes product-alert-style notifications
 * (low stock, expiring). A user-facing `Notification` table does not exist
 * in the Prisma schema yet, so list/markRead/create endpoints for general
 * notifications are intentionally not implemented here. Add them once the
 * schema gains a `Notification` model.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  async getLowStockProducts(
    companyId: string,
  ): Promise<NotificationLowStockListResponse> {
    // Prisma cannot directly compare `stock <= minStock`, so we fetch a
    // small candidate set and filter in memory. Mirrors the original raw SQL
    // behaviour (active products, ordered by stock asc, capped at 20).
    const candidates = await this.repo.findLowStockCandidates(companyId, 100);

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

    const rows = await this.repo.findExpiringProducts(
      companyId,
      thirtyDaysFromNow,
      20,
    );

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
    }));
  }
}
