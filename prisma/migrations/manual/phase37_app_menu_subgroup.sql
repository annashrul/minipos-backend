-- Phase 37: Tambah kolom `subgroup` di app_menus untuk hierarki visual di
-- sidebar (Inventori → Stock / Purchase, dll). Null = render langsung di
-- bawah group tanpa sub-heading. Backfill: cluster Inventori menus.

ALTER TABLE app_menus
  ADD COLUMN IF NOT EXISTS subgroup TEXT;

-- Inventori → Stock
UPDATE app_menus
SET subgroup = 'Stock'
WHERE "group" = 'Inventori'
  AND key IN ('stock', 'stock-adjustment', 'stock-opname', 'stock-transfers');

-- Inventori → Purchase
UPDATE app_menus
SET subgroup = 'Purchase'
WHERE "group" = 'Inventori'
  AND key IN ('purchases', 'receiving');
