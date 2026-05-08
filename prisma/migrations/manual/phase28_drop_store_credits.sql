-- Phase 28: Drop StoreCredit + StoreCreditUsage tables.
-- Tabel tidak punya UI consumer di frontend (cuma DTO contracts) dan 0 rows
-- di DB. Backend module + return STORE_CREDIT method dihapus juga.

DROP TABLE IF EXISTS store_credit_usages CASCADE;
DROP TABLE IF EXISTS store_credits CASCADE;
