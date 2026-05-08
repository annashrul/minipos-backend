-- phase23_modifier_option_dependencies.sql
-- Conditional modifier — option bisa di-filter berdasarkan pilihan group lain.
-- Pattern: ModifierOption (parent) → ModifierOption (dependent).
-- Saat parent dipilih di POS, dependent jadi visible. Tanpa entry = visible
-- tanpa syarat (existing behavior).
-- Use case: Baju warna Hitam → hanya ukuran XL; Putih → S/M/L.

CREATE TABLE IF NOT EXISTS public.modifier_option_dependencies (
  "parentOptionId"    TEXT NOT NULL REFERENCES public.modifier_options(id) ON DELETE CASCADE,
  "dependentOptionId" TEXT NOT NULL REFERENCES public.modifier_options(id) ON DELETE CASCADE,
  PRIMARY KEY ("parentOptionId", "dependentOptionId")
);

CREATE INDEX IF NOT EXISTS idx_modifier_option_dep_parent
  ON public.modifier_option_dependencies ("parentOptionId");
CREATE INDEX IF NOT EXISTS idx_modifier_option_dep_dependent
  ON public.modifier_option_dependencies ("dependentOptionId");
