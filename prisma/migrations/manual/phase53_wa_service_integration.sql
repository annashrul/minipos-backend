-- phase53_wa_service_integration.sql
-- Integrasi WhatsApp gateway lewat service eksternal `wa-service`.
-- Schema changes (semua additive — backward compatible):
--   1. whatsapp_sessions: tambah kolom stage + 3 kolom credentials wa-service
--   2. Index unik untuk wa_service_tenant_id (1 tenant = 1 company)
-- Catatan: kolom lama (auth_creds, phone_number, qr_code, dll) sengaja tidak
-- di-drop. Baileys direct sudah tidak dipakai, tapi data lama tetap aman.

BEGIN;

ALTER TABLE public.whatsapp_sessions
  ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS "wa_service_tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_service_api_key" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_service_webhook_secret" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_wa_service_tenant_id_key"
  ON public.whatsapp_sessions ("wa_service_tenant_id");

COMMIT;
