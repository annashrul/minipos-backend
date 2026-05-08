-- Phase 39: Purchase Transaction Log — record pergerakan status PO sebagai
-- timeline. Plus tambah kolom completedTransactionNumber di PO untuk PT
-- number final saat selesai.

-- Kolom completedTransactionNumber di purchase_orders.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS "completedTransactionNumber" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'purchase_orders_completedTransactionNumber_key'
  ) THEN
    CREATE UNIQUE INDEX "purchase_orders_completedTransactionNumber_key"
      ON purchase_orders ("completedTransactionNumber");
  END IF;
END$$;

-- Tabel purchase_transaction_logs.
CREATE TABLE IF NOT EXISTS purchase_transaction_logs (
  id                TEXT PRIMARY KEY,
  "companyId"       TEXT NOT NULL,
  "branchId"        TEXT,
  "purchaseOrderId" TEXT NOT NULL,
  "documentNumber"  TEXT NOT NULL,
  "documentType"    TEXT NOT NULL,
  status            TEXT NOT NULL,
  amount            DOUBLE PRECISION,
  note              TEXT,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_transaction_logs_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId")
    REFERENCES purchase_orders(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "purchase_transaction_logs_companyId_createdAt_idx"
  ON purchase_transaction_logs ("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "purchase_transaction_logs_purchaseOrderId_createdAt_idx"
  ON purchase_transaction_logs ("purchaseOrderId", "createdAt");

CREATE INDEX IF NOT EXISTS "purchase_transaction_logs_status_idx"
  ON purchase_transaction_logs (status);

CREATE INDEX IF NOT EXISTS "purchase_transaction_logs_documentType_idx"
  ON purchase_transaction_logs ("documentType");

-- Backfill: insert 1 row per PO existing dengan status saat ini.
-- Document number = orderNumber (PO), document type = PO.
INSERT INTO purchase_transaction_logs
  (id, "companyId", "branchId", "purchaseOrderId", "documentNumber",
   "documentType", status, amount, "createdBy", "createdAt")
SELECT
  gen_random_uuid()::text,
  COALESCE(po."companyId", '') AS company_id,
  po."branchId",
  po.id,
  po."orderNumber",
  'PO',
  po.status::text,
  po."totalAmount",
  po."createdBy",
  po."createdAt"
FROM purchase_orders po
WHERE po."companyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM purchase_transaction_logs ptl
    WHERE ptl."purchaseOrderId" = po.id
  );
