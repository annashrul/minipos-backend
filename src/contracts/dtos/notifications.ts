/**
 * Notifications module DTOs.
 * Currently only product-related alerts (low stock, expiring) are exposed.
 * A user-facing "Notification" table does not exist in the Prisma schema yet,
 * so list/markRead/create endpoints for arbitrary notifications are intentionally
 * not defined here. Add them once the schema gets a `Notification` model.
 */

export type NotificationLowStockProduct = {
  id: string;
  name: string;
  code: string;
  stock: number;
  minStock: number;
};

export type NotificationLowStockListResponse = NotificationLowStockProduct[];

export type NotificationExpiringProduct = {
  id: string;
  name: string;
  code: string;
  stock: number;
  // ISO string (or null when no expiry).
  expiryDate: string | null;
};

export type NotificationExpiringListResponse = NotificationExpiringProduct[];
