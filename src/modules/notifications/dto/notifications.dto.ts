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
  expiryDate: string | null;
};

export type NotificationExpiringListResponse = NotificationExpiringProduct[];
