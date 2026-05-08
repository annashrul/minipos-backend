-- Phase 40: Replace completedTransactionNumber dengan purchaseTransactionNumber.
-- Format BL-YYYYMMDD-NNNN, generated saat PO dibuat (sequence per hari per
-- company). Drop old column lalu add new column + backfill.

-- 1. Drop old column completely (with constraint).
ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS "completedTransactionNumber" CASCADE;

-- 2. Add new column nullable dulu.
ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS "purchaseTransactionNumber" CASCADE;

ALTER TABLE purchase_orders
  ADD COLUMN "purchaseTransactionNumber" TEXT;

-- 3. Backfill: BL-YYYYMMDD-NNNN, sequence per (companyId, tanggal).
WITH numbered AS (
  SELECT
    id,
    "companyId",
    "createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", DATE("createdAt")
      ORDER BY "createdAt", id
    ) AS seq
  FROM purchase_orders
)
UPDATE purchase_orders po
SET "purchaseTransactionNumber" =
  'BL-' || TO_CHAR(n."createdAt", 'YYYYMMDD') || '-' || LPAD(n.seq::text, 4, '0')
FROM numbered n
WHERE po.id = n.id;

-- 4. NOT NULL + unique.
ALTER TABLE purchase_orders
  ALTER COLUMN "purchaseTransactionNumber" SET NOT NULL;

-- Unique per (companyId, purchaseTransactionNumber) — multi-tenant scope.
-- BL-YYYYMMDD-NNNN reset sequence per company per hari.
CREATE UNIQUE INDEX
  "purchase_orders_companyId_purchaseTransactionNumber_key"
  ON purchase_orders ("companyId", "purchaseTransactionNumber");

-- 5. Update purchase_transaction_logs PT-xxx → BL-xxx + documentType BL.
UPDATE purchase_transaction_logs ptl
SET "documentNumber" = po."purchaseTransactionNumber",
    "documentType" = 'BL'
FROM purchase_orders po
WHERE ptl."purchaseOrderId" = po.id
  AND ptl."documentType" = 'PT';
