-- Phase 56: Pemakaian Barang (Goods Issue)
-- Pengeluaran stok karena DIPAKAI/dikonsumsi internal (mis. sparepart untuk
-- perbaikan mesin pabrik), bukan dijual. Mirror struktur stock_opnames.
-- Idempotent: aman dijalankan berulang.

CREATE TABLE IF NOT EXISTS "stock_usages" (
  "id"          TEXT NOT NULL,
  "usageNumber" TEXT NOT NULL,
  "branchId"    TEXT,
  "companyId"   TEXT,
  "requestedBy" TEXT,
  "purpose"     TEXT,
  "woNumber"    TEXT,
  "notes"       TEXT,
  "status"      TEXT NOT NULL DEFAULT 'COMPLETED',
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_usages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_usage_items" (
  "id"           TEXT NOT NULL,
  "stockUsageId" TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "variantId"    TEXT,
  "unitId"       TEXT,
  "rackId"       TEXT,
  "quantity"     INTEGER NOT NULL,
  "baseQuantity" INTEGER NOT NULL,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_usage_items_pkey" PRIMARY KEY ("id")
);

-- Unique nomor dokumen per company.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_usages_companyId_usageNumber_key"
  ON "stock_usages" ("companyId", "usageNumber");
CREATE INDEX IF NOT EXISTS "stock_usages_branchId_idx"
  ON "stock_usages" ("branchId");
CREATE INDEX IF NOT EXISTS "stock_usages_companyId_createdAt_idx"
  ON "stock_usages" ("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_usage_items_stockUsageId_idx"
  ON "stock_usage_items" ("stockUsageId");
CREATE INDEX IF NOT EXISTS "stock_usage_items_productId_idx"
  ON "stock_usage_items" ("productId");

-- Foreign keys (guarded: tambah hanya bila belum ada).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_usages_branchId_fkey'
  ) THEN
    ALTER TABLE "stock_usages"
      ADD CONSTRAINT "stock_usages_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_usage_items_stockUsageId_fkey'
  ) THEN
    ALTER TABLE "stock_usage_items"
      ADD CONSTRAINT "stock_usage_items_stockUsageId_fkey"
      FOREIGN KEY ("stockUsageId") REFERENCES "stock_usages"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_usage_items_productId_fkey'
  ) THEN
    ALTER TABLE "stock_usage_items"
      ADD CONSTRAINT "stock_usage_items_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
