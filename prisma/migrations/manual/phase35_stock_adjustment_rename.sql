-- Phase 35: Rename menu "Adjustment Stok" → "Stok Adjustment".
-- Menu key tetap "stock-adjustment" supaya role/action permission tidak
-- perlu di-rebuild. Hanya display name yang berubah.

UPDATE app_menus
SET name = 'Stok Adjustment',
    "updatedAt" = NOW()
WHERE key = 'stock-adjustment';
