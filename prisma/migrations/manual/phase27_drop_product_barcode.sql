-- Phase 27: Drop ProductBarcode table.
-- Reserved/dormant table — model ada di schema tapi tidak ada CRUD endpoint
-- + tidak ada UI consumer + 0 rows di DB. Dipakai hanya untuk read di
-- isBarcodeUsed + findByBarcode (sudah di-update untuk skip tabel ini).
-- Use case "barcode per satuan" sudah cover via ProductUnit.barcode.

DROP TABLE IF EXISTS product_barcodes CASCADE;
