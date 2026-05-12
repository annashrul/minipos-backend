-- Phase 49: Tambah kolom scraping_tokens (JSONB) di shopee_accounts.
-- Untuk simpan anti-bot tokens (x-sap-ri, x-sap-sec, dll) yang dibutuhkan
-- write operations seperti update_product_info_for_quick_edit. Idempotent.

ALTER TABLE shopee_accounts
  ADD COLUMN IF NOT EXISTS scraping_tokens JSONB;
