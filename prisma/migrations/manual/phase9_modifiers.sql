-- phase9_modifiers.sql
-- Add modifier system (F&B variants & add-ons) + per-line modifier snapshot
-- on transaction items.

-- 1) Modifier groups (per company, reusable across products)
CREATE TABLE IF NOT EXISTS public.modifier_groups (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "companyId" TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  "minSelect" INTEGER NOT NULL DEFAULT 0,
  "maxSelect" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modifier_groups_company
  ON public.modifier_groups ("companyId");

-- 2) Options inside a group
CREATE TABLE IF NOT EXISTS public.modifier_options (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "groupId"         TEXT NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  "priceAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modifier_options_group
  ON public.modifier_options ("groupId");

-- 3) Junction: which products use which modifier groups
CREATE TABLE IF NOT EXISTS public.product_modifier_groups (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId"       TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "modifierGroupId" TEXT NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("productId", "modifierGroupId")
);
CREATE INDEX IF NOT EXISTS idx_pmg_product
  ON public.product_modifier_groups ("productId");
CREATE INDEX IF NOT EXISTS idx_pmg_group
  ON public.product_modifier_groups ("modifierGroupId");

-- 4) Per-line snapshot on transaction_items
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS modifiers JSONB,
  ADD COLUMN IF NOT EXISTS notes TEXT;
