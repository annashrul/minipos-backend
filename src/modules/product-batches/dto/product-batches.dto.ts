import { z } from "zod";

// Base pagination — page/perPage selalu ter-resolve ke number (default).
const PaginationBase = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});

// ── Query Schemas ──────────────────────────────────────────

export const ListBatchesQuerySchema = PaginationBase.extend({
  search: z.string().optional(),
  productId: z.string().optional(),
  branchId: z.string().optional(),
  // ACTIVE | DEPLETED | EXPIRED | RECALLED
  status: z.enum(["ACTIVE", "DEPLETED", "EXPIRED", "RECALLED"]).optional(),
  // true = hanya batch yang masih punya sisa (remainingQty > 0).
  inStock: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
});
export type ListBatchesQueryDto = z.infer<typeof ListBatchesQuerySchema>;

export const ExpiringBatchesQuerySchema = PaginationBase.extend({
  // Ambang hari mendekati expired (default 30). Batch dgn expiryDate ≤
  // hari ini + threshold dan remainingQty > 0 akan muncul.
  days: z.coerce.number().int().positive().max(365).default(30),
  branchId: z.string().optional(),
  // Sertakan batch yang sudah lewat tanggal (expiryDate < hari ini).
  includeExpired: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional(),
});
export type ExpiringBatchesQueryDto = z.infer<
  typeof ExpiringBatchesQuerySchema
>;

export const BatchTraceQuerySchema = PaginationBase.extend({
  // Salah satu wajib: telusuri by batchNumber atau by batchId.
  batchNumber: z.string().optional(),
  batchId: z.string().optional(),
});
export type BatchTraceQueryDto = z.infer<typeof BatchTraceQuerySchema>;

// ── Mutation Schemas ───────────────────────────────────────

export const RecallBatchSchema = z.object({
  // Tarik semua batch dengan id ini, atau seluruh batch dgn batchNumber ini.
  batchId: z.string().optional(),
  batchNumber: z.string().optional(),
  reason: z.string().min(1, "Alasan recall wajib diisi"),
});
export type RecallBatchDto = z.infer<typeof RecallBatchSchema>;

// ── Response Types ─────────────────────────────────────────

export type BatchResponse = {
  id: string;
  productId: string;
  productName: string;
  branchId: string | null;
  variantId: string | null;
  variantLabel: string | null;
  batchNumber: string;
  expiryDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  goodsReceiptId: string | null;
  receivedQty: number;
  remainingQty: number;
  unitCost: number | null;
  status: string;
  // Hari tersisa sampai expired (null kalau tanpa expiry). Negatif = sudah
  // lewat.
  daysUntilExpiry: number | null;
  receivedAt: string;
};

export type BatchMovementResponse = {
  id: string;
  batchId: string;
  type: string;
  direction: string;
  quantity: number;
  remainingAfter: number;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdAt: string;
};

// Hasil penelusuran recall: batch + transaksi penjualan yang memakai batch.
export type BatchTraceSaleResponse = {
  movementId: string;
  transactionId: string;
  invoiceNumber: string | null;
  quantity: number;
  soldAt: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
};

export type BatchTraceResponse = {
  batches: BatchResponse[];
  sales: BatchTraceSaleResponse[];
  totalSoldQty: number;
  affectedCustomers: number;
};

export type RecallResultResponse = {
  recalledBatches: number;
  recalledRemainingQty: number;
  affectedSales: number;
};

export const DisposeBatchSchema = z.object({
  batchId: z.string().min(1),
  reason: z.string().max(255).optional(),
});
export type DisposeBatchDto = z.infer<typeof DisposeBatchSchema>;

export type DisposeResultResponse = {
  disposedQty: number;
  status: string;
};

export const BatchStatsQuerySchema = z.object({
  branchId: z.string().optional(),
  // Ambang "mendekati expired" untuk kartu KPI (default 30 hari).
  expiringDays: z.coerce.number().int().positive().max(365).default(30),
});
export type BatchStatsQueryDto = z.infer<typeof BatchStatsQuerySchema>;

export type BatchStatsResponse = {
  // Batch ACTIVE dengan sisa qty > 0.
  activeBatches: number;
  // Total sisa qty seluruh batch ACTIVE.
  totalRemainingQty: number;
  // Batch ACTIVE yang akan kedaluwarsa dalam `expiringDays` (belum lewat).
  expiringSoon: number;
  // Batch ACTIVE yang sudah lewat tanggal kedaluwarsa.
  expired: number;
  // Batch yang ditarik (recall).
  recalled: number;
};
