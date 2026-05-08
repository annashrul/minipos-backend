-- Phase 29: Drop dormant tables — TaxConfig, ApprovalRequest, PriceSchedule.
-- - tax_configs: model+API ada tapi UI tidak ada, tx.taxAmount manual input
-- - approval_requests: model+API ada tapi tidak ada caller di flow utama
-- - price_schedules: punya UI page tapi 0 rows, tidak ada cron yang trigger
--   apply-due, fitur belum aktif

DROP TABLE IF EXISTS price_schedules CASCADE;
DROP TABLE IF EXISTS approval_requests CASCADE;
DROP TABLE IF EXISTS tax_configs CASCADE;
