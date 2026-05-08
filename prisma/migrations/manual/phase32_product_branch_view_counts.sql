-- Phase 32: Tambah unit_count + variant_count di vw_product_branch supaya
-- UI list produk bisa decide row mana yg butuh expand (multi-unit / multi-
-- variant) tanpa fetch terpisah. Pakai LEFT JOIN LATERAL ke aggregate per
-- product — efisien karena tabel kecil & query memo'd di server cache.

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
  COALESCE(bp."sellingPrice", p."sellingPrice")::float8   AS selling_price,
  COALESCE(bp."purchasePrice", p."purchasePrice")::float8 AS purchase_price,
  COALESCE(bs.quantity, p.stock)::int4                    AS stock,
  COALESCE(bs."minStock", p."minStock")::int4             AS min_stock,
  (bs.id IS NOT NULL)                                     AS has_branch_stock,
  (bp.id IS NOT NULL)                                     AS has_branch_price,
  COALESCE(uc.cnt, 0)::int4                               AS unit_count,
  COALESCE(vc.cnt, 0)::int4                               AS variant_count,
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
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM product_units pu WHERE pu."productId" = p.id
) uc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt FROM product_variants pv WHERE pv."productId" = p.id
) vc ON TRUE
WHERE p."companyId" = b."companyId"
  AND p."deletedAt" IS NULL;

COMMENT ON VIEW vw_product_branch IS
  'Product data resolved per branch. Use with WHERE company_id = $1 AND branch_id = $2. '
  'unit_count / variant_count dipakai UI utk decide expand row.';
