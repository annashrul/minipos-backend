import { z } from "zod";

// Satu baris komponen yang dipakai.
export const CreateStockUsageItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  rackId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1),
  notes: z.string().max(300).nullable().optional(),
});
export type CreateStockUsageItemDto = z.infer<typeof CreateStockUsageItemSchema>;

// Dokumen Pemakaian Barang (goods issue) — header + baris.
export const CreateStockUsageSchema = z.object({
  branchId: z.string().min(1),
  requestedBy: z.string().min(1).max(120),
  purpose: z.string().max(200).nullable().optional(),
  woNumber: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(CreateStockUsageItemSchema).min(1).max(100),
});
export type CreateStockUsageDto = z.infer<typeof CreateStockUsageSchema>;

export const ListStockUsageQuerySchema = z.object({
  branchId: z.string().optional(),
  // Cari di usageNumber / requestedBy / purpose.
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListStockUsageQueryDto = z.infer<typeof ListStockUsageQuerySchema>;

export type StockUsageItemResponse = {
  id: string;
  productId: string;
  product: { id: string; name: string; code: string; unit: string } | null;
  variantId: string | null;
  unitId: string | null;
  rackId: string | null;
  quantity: number;
  baseQuantity: number;
  notes: string | null;
};

export type StockUsageResponse = {
  id: string;
  usageNumber: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  requestedBy: string | null;
  purpose: string | null;
  woNumber: string | null;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  itemCount: number;
  totalQty: number;
  // Hanya terisi pada detail (findOne).
  items?: StockUsageItemResponse[];
};
