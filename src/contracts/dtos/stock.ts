import { z } from "zod";

export const StockMovementTypeSchema = z.enum([
  // Legacy
  "IN",
  "OUT",
  "ADJUSTMENT",
  "TRANSFER",
  "OPNAME",
  // Granular (ledger refactor)
  "PURCHASE_RECEIVE",
  "SALE",
  "RETURN_IN",
  "RETURN_OUT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "OPNAME_ADJUSTMENT",
  "WASTE",
  "RECIPE_DEDUCT",
  "MANUAL_IN",
  "MANUAL_OUT",
  "RTV",
]);
export type StockMovementTypeDto = z.infer<typeof StockMovementTypeSchema>;

export const ListStockMovementsQuerySchema = z.object({
  productId: z.string().optional(),
  branchId: z.string().optional(),
  type: StockMovementTypeSchema.optional(),
  // Filter ke movement origin spesifik (mis. "manual_adjustment" untuk
  // halaman Stok Adjustment, "transaction" untuk POS sales).
  refType: z.string().optional(),
  reference: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListStockMovementsQueryDto = z.infer<
  typeof ListStockMovementsQuerySchema
>;

export type StockMovementResponse = {
  id: string;
  productId: string;
  product: { id: string; name: string; code: string; unit: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  /** Varian terkait pergerakan (Putih · S). Null untuk produk non-variant. */
  variantId: string | null;
  variantLabel: string | null;
  unitId: string | null;
  unitName: string | null;
  unitQuantity: number | null;
  type: string;
  quantity: number;
  note: string | null;
  reference: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type StockMovementListResponse = {
  movements: StockMovementResponse[];
  total: number;
  totalPages: number;
};

export const AdjustStockSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  // Optional — di-set kalau user pick SKU spesifik (multi-satuan/varian).
  // Kalau null, adjust stok di base SKU row (unitId=null, variantId=null).
  unitId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  quantity: z.number().int().min(1),
  note: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  // Phase 2B: optional rakId — kalau diisi, adjustment juga dilakukan di
  // RackStock rak tsb. Kalau null, fallback ke product.defaultRackId.
  rackId: z.string().uuid().nullable().optional(),
});
export type AdjustStockDto = z.infer<typeof AdjustStockSchema>;

export const ListBranchStockQuerySchema = z.object({
  branchId: z.string().min(1),
  search: z.string().optional(),
  lowStock: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBranchStockQueryDto = z.infer<typeof ListBranchStockQuerySchema>;

export type BranchStockResponse = {
  id: string;
  branchId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string } | null;
  quantity: number;
  minStock: number;
  updatedAt: string;
};

export type BranchStockListResponse = {
  stocks: BranchStockResponse[];
  total: number;
  totalPages: number;
};

// ===== Stock Card / Kartu Stok =====
export const StockCardQuerySchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().optional(),
  // Filter row movement ke 1 varian saja. Kalau kosong, tampilkan semua
  // varian (movement non-variant + tiap varian) — UI bisa group sendiri.
  variantId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: StockMovementTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(500).default(50),
});
export type StockCardQueryDto = z.infer<typeof StockCardQuerySchema>;

export type StockCardEntry = {
  id: string;
  date: string;
  type: string;
  direction: "IN" | "OUT" | null;
  qtyIn: number;
  qtyOut: number;
  balanceAfter: number | null;
  unitCost: number | null;
  totalCost: number | null;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdBy: string | null;
  branch: { id: string; name: string } | null;
  /** Varian terkait pergerakan (Putih · S). Null untuk produk non-variant
   *  atau row legacy sebelum migrasi variant. */
  variantId: string | null;
  variantLabel: string | null;
};

export type StockCardVariantOption = {
  id: string;
  label: string;
};

export type StockCardSummary = {
  openingBalance: number; // saldo sebelum periode
  totalIn: number; // jumlah qty masuk dlm periode
  totalOut: number; // jumlah qty keluar dlm periode
  endingBalance: number; // saldo akhir periode
  movementCount: number;
};

export type StockCardResponse = {
  product: { id: string; name: string; code: string; unit: string } | null;
  branch: { id: string; name: string } | null;
  /** Daftar varian yang dimiliki produk — UI pakai untuk filter dropdown. */
  variants: StockCardVariantOption[];
  summary: StockCardSummary;
  entries: StockCardEntry[];
  total: number;
  totalPages: number;
};
