-- phase25_product_branch_sku.sql
-- Single source of truth untuk inventory: Cabang × Satuan × Varian.
-- Tiap row = 1 SKU dengan harga jual + harga beli + stok mandiri.
--
-- Backfill strategy: derive SKU dari kombinasi existing branchPrices +
-- ProductUnit + ProductVariant. Untuk produk yang sebelumnya hanya pakai
-- branchPrice (tanpa unit/variant), buat 1 SKU per (product, branch) dengan
-- unitId=null, variantId=null.

CREATE TABLE IF NOT EXISTS public.product_branch_skus (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId"     TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "branchId"      TEXT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  "unitId"        TEXT REFERENCES public.product_units(id) ON DELETE CASCADE,
  "variantId"     TEXT REFERENCES public.product_variants(id) ON DELETE CASCADE,
  "sellingPrice"  DOUBLE PRECISION NOT NULL,
  "purchasePrice" DOUBLE PRECISION NOT NULL,
  stock           INTEGER NOT NULL DEFAULT 0,
  "minStock"      INTEGER NOT NULL DEFAULT 5,
  barcode         TEXT UNIQUE,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pbs_product
  ON public.product_branch_skus ("productId");
CREATE INDEX IF NOT EXISTS idx_pbs_branch
  ON public.product_branch_skus ("branchId");
CREATE INDEX IF NOT EXISTS idx_pbs_product_branch
  ON public.product_branch_skus ("productId", "branchId");
CREATE INDEX IF NOT EXISTS idx_pbs_barcode
  ON public.product_branch_skus (barcode);

-- Backfill base SKU (unitId=null, variantId=null) dari branch_product_prices.
-- Skip kalau row sudah ada (idempotent).
INSERT INTO public.product_branch_skus
  (id, "productId", "branchId", "unitId", "variantId",
   "sellingPrice", "purchasePrice", stock, "minStock", "isActive",
   "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  bpp."productId",
  bpp."branchId",
  NULL,
  NULL,
  bpp."sellingPrice",
  bpp."purchasePrice",
  COALESCE(bs.quantity, 0),
  COALESCE(bs."minStock", 5),
  TRUE,
  now(),
  now()
FROM public.branch_product_prices bpp
LEFT JOIN public.branch_stocks bs
  ON bs."productId" = bpp."productId" AND bs."branchId" = bpp."branchId"
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_branch_skus s
  WHERE s."productId" = bpp."productId"
    AND s."branchId" = bpp."branchId"
    AND s."unitId" IS NULL
    AND s."variantId" IS NULL
);
