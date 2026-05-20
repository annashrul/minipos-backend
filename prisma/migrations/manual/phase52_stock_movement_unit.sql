-- Phase 52: Tambah unitId + unitQuantity di stock_movements supaya pergerakan
-- stok bisa mencatat satuan spesifik. Berguna untuk produk multi-satuan dan
-- untuk tracking stok pada satuan yang berbeda (PCS, BOX, DUS, dll).

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS "unitId"       TEXT,
  ADD COLUMN IF NOT EXISTS "unitQuantity" INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_unitId_fkey'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT "stock_movements_unitId_fkey"
      FOREIGN KEY ("unitId")
      REFERENCES product_units(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "stock_movements_unitId_idx"
  ON stock_movements ("unitId");
