-- ============================================================
-- View: Product with branch-specific prices and stock
-- Provides a single queryable view that resolves per-branch
-- prices and stock with fallback to product defaults.
-- ============================================================

DROP VIEW IF EXISTS vw_product_branch;

CREATE OR REPLACE VIEW vw_product_branch AS
SELECT
  p.id              AS product_id,
  p.code            AS product_code,
  p.name            AS product_name,
  p."categoryId"    AS category_id,
  c.name            AS category_name,
  p."brandId"       AS brand_id,
  p."companyId"     AS company_id,
  p.unit            AS base_unit,
  p."isActive"      AS is_active,
  p."imageUrl"      AS image_url,
  p.barcode         AS barcode,
  p.description     AS description,
  b.id              AS branch_id,
  b.name            AS branch_name,
  b.code            AS branch_code,
  -- Prices: branch-specific with fallback to product default (cast to float8)
  COALESCE(bp."sellingPrice", p."sellingPrice")::float8   AS selling_price,
  COALESCE(bp."purchasePrice", p."purchasePrice")::float8 AS purchase_price,
  -- Stock: branch-specific with fallback to product default (cast to int4)
  COALESCE(bs.quantity, p.stock)::int4                    AS stock,
  COALESCE(bs."minStock", p."minStock")::int4             AS min_stock,
  -- Flags
  (bs.id IS NOT NULL)                             AS has_branch_stock,
  (bp.id IS NOT NULL)                             AS has_branch_price,
  p."createdAt"     AS created_at,
  p."updatedAt"     AS updated_at
FROM products p
CROSS JOIN branches b
LEFT JOIN branch_product_prices bp
  ON bp."productId" = p.id AND bp."branchId" = b.id
LEFT JOIN branch_stocks bs
  ON bs."productId" = p.id AND bs."branchId" = b.id
LEFT JOIN categories c
  ON c.id = p."categoryId"
WHERE p."companyId" = b."companyId"
  AND p."deletedAt" IS NULL;

-- Index-friendly: queries should filter on company_id + branch_id + is_active
COMMENT ON VIEW vw_product_branch IS
  'Product data resolved per branch. Use with WHERE company_id = $1 AND branch_id = $2. '
  'Prices and stock fall back to product defaults when no branch-specific record exists.';
