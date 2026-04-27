-- ============================================================
-- PHASE 2: Materialized Views for Dashboard & Reports
-- ============================================================

-- ============================================================
-- 1. MV: Daily sales summary (for dashboard charts)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales_summary AS
SELECT
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt")::date AS sale_date,
  COUNT(DISTINCT t.id)::int AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0)::float AS total_sales,
  COALESCE(SUM(t."discountAmount"), 0)::float AS total_discount,
  COALESCE(SUM(t."taxAmount"), 0)::float AS total_tax,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::float AS total_cogs,
  (COALESCE(SUM(t."grandTotal"), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0))::float AS total_profit,
  COALESCE(SUM(ti.quantity), 0)::int AS items_sold
FROM transactions t
JOIN transaction_items ti ON ti."transactionId" = t.id
JOIN products p ON p.id = ti."productId"
WHERE t.status = 'COMPLETED'
GROUP BY t."branchId", DATE_TRUNC('day', t."createdAt")
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_sales_summary_idx
  ON mv_daily_sales_summary (branch_id, sale_date);
CREATE INDEX IF NOT EXISTS mv_daily_sales_summary_date_idx
  ON mv_daily_sales_summary (sale_date);


-- ============================================================
-- 2. MV: Monthly sales summary
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_sales_summary AS
SELECT
  t."branchId" AS branch_id,
  DATE_TRUNC('month', t."createdAt")::date AS sale_month,
  COUNT(DISTINCT t.id)::int AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0)::float AS total_sales,
  COALESCE(SUM(t."discountAmount"), 0)::float AS total_discount,
  COALESCE(SUM(t."taxAmount"), 0)::float AS total_tax,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::float AS total_cogs,
  (COALESCE(SUM(t."grandTotal"), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0))::float AS total_profit,
  COALESCE(SUM(ti.quantity), 0)::int AS items_sold
FROM transactions t
JOIN transaction_items ti ON ti."transactionId" = t.id
JOIN products p ON p.id = ti."productId"
WHERE t.status = 'COMPLETED'
GROUP BY t."branchId", DATE_TRUNC('month', t."createdAt")
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_monthly_sales_summary_idx
  ON mv_monthly_sales_summary (branch_id, sale_month);


-- ============================================================
-- 3. MV: Product sales ranking
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_sales_ranking AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.code AS product_code,
  c.name AS category_name,
  p."categoryId" AS category_id,
  p."companyId" AS company_id,
  t."branchId" AS branch_id,
  DATE_TRUNC('month', t."createdAt")::date AS sale_month,
  SUM(ti.quantity)::int AS total_qty,
  COALESCE(SUM(ti.subtotal), 0)::float AS total_revenue,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::float AS total_cost,
  (COALESCE(SUM(ti.subtotal), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0))::float AS profit,
  CASE WHEN COALESCE(SUM(ti.subtotal), 0) > 0
    THEN ((COALESCE(SUM(ti.subtotal), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)) / COALESCE(SUM(ti.subtotal), 0) * 100)::float
    ELSE 0
  END AS margin_percent
FROM transaction_items ti
JOIN transactions t ON t.id = ti."transactionId"
JOIN products p ON p.id = ti."productId"
LEFT JOIN categories c ON c.id = p."categoryId"
WHERE t.status = 'COMPLETED'
GROUP BY p.id, p.name, p.code, c.name, p."categoryId", p."companyId", t."branchId", DATE_TRUNC('month', t."createdAt")
WITH DATA;

CREATE INDEX IF NOT EXISTS mv_product_sales_ranking_branch_month_idx
  ON mv_product_sales_ranking (branch_id, sale_month);
CREATE INDEX IF NOT EXISTS mv_product_sales_ranking_company_idx
  ON mv_product_sales_ranking (company_id);


-- ============================================================
-- 4. MV: Cashier performance summary
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_cashier_performance AS
SELECT
  t."userId" AS user_id,
  u.name AS user_name,
  u.email AS user_email,
  u.role AS user_role,
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt")::date AS sale_date,
  COUNT(DISTINCT t.id)::int AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0)::float AS total_revenue,
  COALESCE(SUM(t."discountAmount"), 0)::float AS total_discount,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::float AS total_cost,
  COALESCE(SUM(ti.quantity), 0)::int AS items_sold
FROM transactions t
JOIN transaction_items ti ON ti."transactionId" = t.id
JOIN products p ON p.id = ti."productId"
JOIN users u ON u.id = t."userId"
WHERE t.status = 'COMPLETED'
GROUP BY t."userId", u.name, u.email, u.role, t."branchId", DATE_TRUNC('day', t."createdAt")
WITH DATA;

CREATE INDEX IF NOT EXISTS mv_cashier_performance_user_date_idx
  ON mv_cashier_performance (user_id, sale_date);
CREATE INDEX IF NOT EXISTS mv_cashier_performance_branch_idx
  ON mv_cashier_performance (branch_id, sale_date);


-- ============================================================
-- 5. MV: Payment method breakdown
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_payment_method_summary AS
SELECT
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt")::date AS sale_date,
  t."paymentMethod"::text AS payment_method,
  COUNT(*)::int AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0)::float AS total_amount
FROM transactions t
WHERE t.status = 'COMPLETED'
GROUP BY t."branchId", DATE_TRUNC('day', t."createdAt"), t."paymentMethod"
WITH DATA;

CREATE INDEX IF NOT EXISTS mv_payment_method_summary_idx
  ON mv_payment_method_summary (branch_id, sale_date);


-- ============================================================
-- 6. FUNCTION: Refresh all materialized views
-- ============================================================
CREATE OR REPLACE FUNCTION fn_refresh_all_mvs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_sales_summary;
  REFRESH MATERIALIZED VIEW mv_product_sales_ranking;
  REFRESH MATERIALIZED VIEW mv_cashier_performance;
  REFRESH MATERIALIZED VIEW mv_payment_method_summary;
END;
$$;

-- ============================================================
-- 7. FUNCTION: Refresh daily MVs only (lighter, call more often)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_refresh_daily_mvs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales_summary;
  REFRESH MATERIALIZED VIEW mv_payment_method_summary;
  REFRESH MATERIALIZED VIEW mv_cashier_performance;
END;
$$;
