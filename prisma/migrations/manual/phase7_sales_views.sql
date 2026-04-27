-- phase7_sales_views.sql
-- (Re)create read-only fact views used by reports.service.ts.
-- Both views derive `company_id` via JOIN to users (transaction.user.companyId)
-- since the transactions table itself has no company_id column.
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/db/prisma/migrations/manual/phase7_sales_views.sql

DROP VIEW IF EXISTS public.vw_sales_transactions_fact CASCADE;
DROP VIEW IF EXISTS public.vw_sales_item_facts CASCADE;

CREATE VIEW public.vw_sales_transactions_fact AS
SELECT
  t.id                       AS transaction_id,
  u."companyId"              AS company_id,
  t."branchId"               AS branch_id,
  t."userId"                 AS user_id,
  u.name                     AS cashier_name,
  u.email                    AS cashier_email,
  u.role                     AS cashier_role,
  t."grandTotal"             AS grand_total,
  t.subtotal                 AS subtotal,
  t."discountAmount"         AS discount_amount,
  t."taxAmount"              AS tax_amount,
  t."paymentMethod"          AS payment_method,
  t.status                   AS status,
  t."createdAt"              AS tx_created_at
FROM public.transactions t
JOIN public.users u ON u.id = t."userId"
WHERE t.status = 'COMPLETED';

CREATE VIEW public.vw_sales_item_facts AS
SELECT
  ti.id                      AS item_id,
  ti."transactionId"         AS transaction_id,
  u."companyId"              AS company_id,
  t."branchId"               AS branch_id,
  t."userId"                 AS user_id,
  u.name                     AS cashier_name,
  u.email                    AS cashier_email,
  u.role                     AS cashier_role,
  ti."productId"             AS product_id,
  ti."productName"           AS product_name,
  ti."productCode"           AS product_code,
  p."categoryId"             AS category_id,
  c.name                     AS category_name,
  p."supplierId"             AS supplier_id,
  s.name                     AS supplier_name,
  p."brandId"                AS brand_id,
  b.name                     AS brand_name,
  ti.quantity                AS quantity,
  ti."unitPrice"             AS unit_price,
  ti.discount                AS discount,
  ti.subtotal                AS subtotal,
  p."purchasePrice"          AS purchase_price,
  t.status                   AS status,
  t."createdAt"              AS tx_created_at
FROM public.transaction_items ti
JOIN public.transactions t ON t.id = ti."transactionId"
JOIN public.users u         ON u.id = t."userId"
JOIN public.products p      ON p.id = ti."productId"
LEFT JOIN public.categories c ON c.id = p."categoryId"
LEFT JOIN public.suppliers  s ON s.id = p."supplierId"
LEFT JOIN public.brands     b ON b.id = p."brandId"
WHERE t.status = 'COMPLETED';

-- Optional helper indexes on underlying tables to speed up common filters.
-- Skip if your DB already indexes these (Prisma manages most of them).
CREATE INDEX IF NOT EXISTS idx_users_company
  ON public.users ("companyId");
