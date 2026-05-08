-- Phase 26: Drop ProductPriceHistory table.
-- Model orphan — exists di schema tapi tidak pernah di-write/read di code.
-- Confirmed via audit: 0 rows di DB, no service/controller references.
-- Safe to drop.

DROP TABLE IF EXISTS product_price_histories CASCADE;
