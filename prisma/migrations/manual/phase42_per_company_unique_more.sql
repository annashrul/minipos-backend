-- Phase 42: Apply XX-YYYYMMDD-NNNN format ke modul lain dgn ubah unique
-- ke per-company. StockOpname.opnameNumber, StockTransfer.transferNumber,
-- ServiceOrder.orderNumber.

-- Drop unique global lama.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'stock_opnames_opnameNumber_key'
  ) THEN
    DROP INDEX "stock_opnames_opnameNumber_key";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'stock_transfers_transferNumber_key'
  ) THEN
    DROP INDEX "stock_transfers_transferNumber_key";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'service_orders_order_number_key'
  ) THEN
    DROP INDEX "service_orders_order_number_key";
  END IF;
END$$;

-- Buat unique composite per (companyId, number).
CREATE UNIQUE INDEX IF NOT EXISTS
  "stock_opnames_companyId_opnameNumber_key"
  ON stock_opnames ("companyId", "opnameNumber");

CREATE UNIQUE INDEX IF NOT EXISTS
  "stock_transfers_companyId_transferNumber_key"
  ON stock_transfers ("companyId", "transferNumber");

CREATE UNIQUE INDEX IF NOT EXISTS
  "service_orders_company_id_order_number_key"
  ON service_orders ("company_id", "order_number");
