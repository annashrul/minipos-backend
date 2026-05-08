-- Phase 41: Ubah unique constraint global → per-company untuk
-- purchase_orders.orderNumber dan goods_receipts.receiptNumber.
-- Sequence number `XX-YYYYMMDD-NNNN` reset per company per hari, jadi
-- tidak boleh global unique (companyA & companyB bisa punya nomor sama).

-- Drop unique global lama.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'purchase_orders_orderNumber_key'
  ) THEN
    DROP INDEX "purchase_orders_orderNumber_key";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'goods_receipts_receiptNumber_key'
  ) THEN
    DROP INDEX "goods_receipts_receiptNumber_key";
  END IF;
END$$;

-- Buat unique composite per (companyId, orderNumber/receiptNumber).
CREATE UNIQUE INDEX IF NOT EXISTS
  "purchase_orders_companyId_orderNumber_key"
  ON purchase_orders ("companyId", "orderNumber");

CREATE UNIQUE INDEX IF NOT EXISTS
  "goods_receipts_companyId_receiptNumber_key"
  ON goods_receipts ("companyId", "receiptNumber");
