-- ============================================================
-- PHASE 1: Database Optimization - Functions, Triggers, Views
-- ============================================================

-- ============================================================
-- 1. TRIGGER: Auto-update debt status on payment insert
-- ============================================================
CREATE OR REPLACE FUNCTION fn_debt_recalculate_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total DOUBLE PRECISION;
  v_paid DOUBLE PRECISION;
  v_remaining DOUBLE PRECISION;
  v_new_status "DebtStatus";
BEGIN
  -- Recalculate from all payments
  SELECT
    d."totalAmount",
    COALESCE(SUM(dp.amount), 0)
  INTO v_total, v_paid
  FROM debts d
  LEFT JOIN debt_payments dp ON dp."debtId" = d.id
  WHERE d.id = NEW."debtId"
  GROUP BY d."totalAmount";

  v_remaining := GREATEST(v_total - v_paid, 0);

  IF v_remaining <= 0 THEN
    v_new_status := 'PAID';
  ELSIF v_paid > 0 THEN
    v_new_status := 'PARTIAL';
  ELSE
    v_new_status := 'UNPAID';
  END IF;

  UPDATE debts
  SET
    "paidAmount" = v_paid,
    "remainingAmount" = v_remaining,
    status = v_new_status,
    "updatedAt" = NOW()
  WHERE id = NEW."debtId";

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debt_recalculate_on_payment ON debt_payments;
CREATE TRIGGER trg_debt_recalculate_on_payment
  AFTER INSERT ON debt_payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_debt_recalculate_on_payment();

-- Also handle payment deletion
CREATE OR REPLACE FUNCTION fn_debt_recalculate_on_payment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total DOUBLE PRECISION;
  v_paid DOUBLE PRECISION;
  v_remaining DOUBLE PRECISION;
  v_new_status "DebtStatus";
BEGIN
  SELECT
    d."totalAmount",
    COALESCE(SUM(dp.amount), 0)
  INTO v_total, v_paid
  FROM debts d
  LEFT JOIN debt_payments dp ON dp."debtId" = d.id
  WHERE d.id = OLD."debtId"
  GROUP BY d."totalAmount";

  v_remaining := GREATEST(v_total - v_paid, 0);

  IF v_remaining <= 0 THEN
    v_new_status := 'PAID';
  ELSIF v_paid > 0 THEN
    v_new_status := 'PARTIAL';
  ELSE
    v_new_status := 'UNPAID';
  END IF;

  UPDATE debts
  SET
    "paidAmount" = v_paid,
    "remainingAmount" = v_remaining,
    status = v_new_status,
    "updatedAt" = NOW()
  WHERE id = OLD."debtId";

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_debt_recalculate_on_payment_delete ON debt_payments;
CREATE TRIGGER trg_debt_recalculate_on_payment_delete
  AFTER DELETE ON debt_payments
  FOR EACH ROW
  EXECUTE FUNCTION fn_debt_recalculate_on_payment_delete();


-- ============================================================
-- 2. VIEW: Profit summary (reusable across dashboard + reports)
-- ============================================================
CREATE OR REPLACE VIEW vw_profit_summary AS
SELECT
  t."branchId" AS branch_id,
  b.name AS branch_name,
  DATE_TRUNC('day', t."createdAt") AS sale_date,
  DATE_TRUNC('month', t."createdAt") AS sale_month,
  COUNT(DISTINCT t.id) AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0) AS revenue,
  COALESCE(SUM(t."discountAmount"), 0) AS discount,
  COALESCE(SUM(t."taxAmount"), 0) AS tax,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) AS cogs,
  COALESCE(SUM(t."grandTotal"), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) AS gross_profit
FROM transactions t
JOIN transaction_items ti ON ti."transactionId" = t.id
JOIN products p ON p.id = ti."productId"
LEFT JOIN branches b ON b.id = t."branchId"
WHERE t.status = 'COMPLETED'
GROUP BY t."branchId", b.name, DATE_TRUNC('day', t."createdAt"), DATE_TRUNC('month', t."createdAt");


-- ============================================================
-- 3. VIEW: Overdue debts
-- ============================================================
CREATE OR REPLACE VIEW vw_overdue_debts AS
SELECT
  d.*,
  EXTRACT(DAY FROM NOW() - d."dueDate") AS days_overdue
FROM debts d
WHERE d.status IN ('UNPAID', 'PARTIAL')
  AND d."dueDate" IS NOT NULL
  AND d."dueDate" < NOW();


-- ============================================================
-- 4. VIEW: Low stock products
-- ============================================================
CREATE OR REPLACE VIEW vw_low_stock_products AS
SELECT
  p.id,
  p.name,
  p.code,
  p.stock,
  p."minStock",
  p."categoryId",
  c.name AS category_name,
  p."companyId",
  CASE
    WHEN p.stock = 0 THEN 'OUT_OF_STOCK'
    WHEN p.stock <= p."minStock" THEN 'LOW_STOCK'
    ELSE 'NORMAL'
  END AS stock_status
FROM products p
LEFT JOIN categories c ON c.id = p."categoryId"
WHERE p."isActive" = true
  AND p.stock <= p."minStock"
ORDER BY p.stock ASC;


-- ============================================================
-- 5. VIEW: Hourly sales distribution
-- ============================================================
CREATE OR REPLACE VIEW vw_hourly_sales AS
SELECT
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt") AS sale_date,
  EXTRACT(HOUR FROM t."createdAt")::int AS hour,
  COUNT(*)::int AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0) AS total_sales
FROM transactions t
WHERE t.status = 'COMPLETED'
GROUP BY t."branchId", DATE_TRUNC('day', t."createdAt"), EXTRACT(HOUR FROM t."createdAt");


-- ============================================================
-- 6. VIEW: Cashier performance base
-- ============================================================
CREATE OR REPLACE VIEW vw_cashier_performance AS
SELECT
  t."userId" AS user_id,
  u.name AS user_name,
  u.email AS user_email,
  u.role AS user_role,
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt") AS sale_date,
  COUNT(DISTINCT t.id) AS transaction_count,
  COALESCE(SUM(t."grandTotal"), 0) AS total_revenue,
  COALESCE(SUM(t."discountAmount"), 0) AS total_discount,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) AS total_cost,
  COALESCE(SUM(ti.quantity), 0)::int AS items_sold
FROM transactions t
JOIN transaction_items ti ON ti."transactionId" = t.id
JOIN products p ON p.id = ti."productId"
JOIN users u ON u.id = t."userId"
WHERE t.status = 'COMPLETED'
GROUP BY t."userId", u.name, u.email, u.role, t."branchId", DATE_TRUNC('day', t."createdAt");


-- ============================================================
-- 7. VIEW: Debt summary by type
-- ============================================================
CREATE OR REPLACE VIEW vw_debt_summary AS
SELECT
  d.type,
  d."branchId" AS branch_id,
  d.status,
  COUNT(*) AS debt_count,
  COALESCE(SUM(d."totalAmount"), 0) AS total_amount,
  COALESCE(SUM(d."paidAmount"), 0) AS paid_amount,
  COALESCE(SUM(d."remainingAmount"), 0) AS remaining_amount
FROM debts d
GROUP BY d.type, d."branchId", d.status;


-- ============================================================
-- 8. VIEW: Category sales (for reports)
-- ============================================================
CREATE OR REPLACE VIEW vw_category_sales AS
SELECT
  c.id AS category_id,
  c.name AS category_name,
  t."branchId" AS branch_id,
  DATE_TRUNC('day', t."createdAt") AS sale_date,
  COUNT(DISTINCT t.id) AS transaction_count,
  COALESCE(SUM(ti.quantity), 0)::int AS total_quantity,
  COALESCE(SUM(ti.subtotal), 0) AS total_revenue,
  COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) AS total_cost,
  COALESCE(SUM(ti.subtotal), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) AS profit
FROM transaction_items ti
JOIN transactions t ON t.id = ti."transactionId"
JOIN products p ON p.id = ti."productId"
LEFT JOIN categories c ON c.id = p."categoryId"
WHERE t.status = 'COMPLETED'
GROUP BY c.id, c.name, t."branchId", DATE_TRUNC('day', t."createdAt");


-- ============================================================
-- 9. FUNCTION: Get profit metrics for a period
-- ============================================================
CREATE OR REPLACE FUNCTION fn_get_profit_metrics(
  p_start TIMESTAMP,
  p_end TIMESTAMP,
  p_branch_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  revenue DOUBLE PRECISION,
  cogs DOUBLE PRECISION,
  gross_profit DOUBLE PRECISION,
  discount DOUBLE PRECISION,
  tax DOUBLE PRECISION,
  expense DOUBLE PRECISION,
  net_profit DOUBLE PRECISION,
  transaction_count BIGINT,
  items_sold BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_expense DOUBLE PRECISION;
BEGIN
  -- Get expense total
  SELECT COALESCE(SUM(e.amount), 0)
  INTO v_expense
  FROM expenses e
  WHERE e.date >= p_start AND e.date < p_end
    AND (p_branch_id IS NULL OR e."branchId" = p_branch_id OR e."branchId" IS NULL)
    AND (p_company_id IS NULL OR e."branchId" IN (SELECT id FROM branches WHERE "companyId" = p_company_id));

  RETURN QUERY
  SELECT
    COALESCE(SUM(t."grandTotal"), 0)::DOUBLE PRECISION AS revenue,
    COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::DOUBLE PRECISION AS cogs,
    (COALESCE(SUM(t."grandTotal"), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0))::DOUBLE PRECISION AS gross_profit,
    COALESCE(SUM(t."discountAmount"), 0)::DOUBLE PRECISION AS discount,
    COALESCE(SUM(t."taxAmount"), 0)::DOUBLE PRECISION AS tax,
    v_expense AS expense,
    (COALESCE(SUM(t."grandTotal"), 0) - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0) - v_expense)::DOUBLE PRECISION AS net_profit,
    COUNT(DISTINCT t.id) AS transaction_count,
    COALESCE(SUM(ti.quantity), 0) AS items_sold
  FROM transactions t
  JOIN transaction_items ti ON ti."transactionId" = t.id
  JOIN products p ON p.id = ti."productId"
  WHERE t.status = 'COMPLETED'
    AND t."createdAt" >= p_start
    AND t."createdAt" < p_end
    AND (p_branch_id IS NULL OR t."branchId" = p_branch_id)
    AND (p_company_id IS NULL OR t."branchId" IN (SELECT id FROM branches WHERE "companyId" = p_company_id));
END;
$$;


-- ============================================================
-- 10. FUNCTION: Get dashboard summary stats
-- ============================================================
CREATE OR REPLACE FUNCTION fn_get_dashboard_sales(
  p_start TIMESTAMP,
  p_end TIMESTAMP,
  p_branch_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  total_sales DOUBLE PRECISION,
  transaction_count BIGINT,
  total_profit DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(t."grandTotal"), 0)::DOUBLE PRECISION,
    COUNT(*)::BIGINT,
    (COALESCE(SUM(t."grandTotal"), 0) - COALESCE((
      SELECT SUM(ti2.quantity * p2."purchasePrice")
      FROM transaction_items ti2
      JOIN products p2 ON p2.id = ti2."productId"
      WHERE ti2."transactionId" = ANY(ARRAY_AGG(t.id))
    ), 0))::DOUBLE PRECISION
  FROM transactions t
  WHERE t.status = 'COMPLETED'
    AND t."createdAt" >= p_start
    AND t."createdAt" < p_end
    AND (p_branch_id IS NULL OR t."branchId" = p_branch_id)
    AND (p_company_id IS NULL OR t."branchId" IN (SELECT id FROM branches WHERE "companyId" = p_company_id));
END;
$$;


-- ============================================================
-- 11. FUNCTION: Get top products for a period
-- ============================================================
CREATE OR REPLACE FUNCTION fn_get_top_products(
  p_start TIMESTAMP,
  p_end TIMESTAMP,
  p_branch_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  product_id TEXT,
  product_name TEXT,
  product_code TEXT,
  category_name TEXT,
  total_qty BIGINT,
  total_revenue DOUBLE PRECISION,
  total_cost DOUBLE PRECISION,
  profit DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    ti."productName",
    ti."productCode",
    c.name,
    SUM(ti.quantity)::BIGINT,
    SUM(ti.subtotal)::DOUBLE PRECISION,
    SUM(ti.quantity * p."purchasePrice")::DOUBLE PRECISION,
    (SUM(ti.subtotal) - SUM(ti.quantity * p."purchasePrice"))::DOUBLE PRECISION
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti."transactionId"
  JOIN products p ON p.id = ti."productId"
  LEFT JOIN categories c ON c.id = p."categoryId"
  WHERE t.status = 'COMPLETED'
    AND t."createdAt" >= p_start
    AND t."createdAt" < p_end
    AND (p_branch_id IS NULL OR t."branchId" = p_branch_id)
    AND (p_company_id IS NULL OR t."branchId" IN (SELECT id FROM branches WHERE "companyId" = p_company_id))
  GROUP BY p.id, ti."productName", ti."productCode", c.name
  ORDER BY SUM(ti.quantity) DESC
  LIMIT p_limit;
END;
$$;


-- ============================================================
-- 12. FUNCTION: Get category sales report
-- ============================================================
CREATE OR REPLACE FUNCTION fn_get_category_sales_report(
  p_start TIMESTAMP,
  p_end TIMESTAMP,
  p_branch_id TEXT DEFAULT NULL,
  p_company_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  category_id TEXT,
  category_name TEXT,
  total_quantity BIGINT,
  total_revenue DOUBLE PRECISION,
  total_cost DOUBLE PRECISION,
  transaction_count BIGINT,
  profit DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    COALESCE(c.name, 'Tanpa Kategori'),
    SUM(ti.quantity)::BIGINT,
    SUM(ti.subtotal)::DOUBLE PRECISION,
    SUM(ti.quantity * p."purchasePrice")::DOUBLE PRECISION,
    COUNT(DISTINCT t.id)::BIGINT,
    (SUM(ti.subtotal) - SUM(ti.quantity * p."purchasePrice"))::DOUBLE PRECISION
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti."transactionId"
  JOIN products p ON p.id = ti."productId"
  LEFT JOIN categories c ON c.id = p."categoryId"
  WHERE t.status = 'COMPLETED'
    AND t."createdAt" >= p_start
    AND t."createdAt" < p_end
    AND (p_branch_id IS NULL OR t."branchId" = p_branch_id)
    AND (p_company_id IS NULL OR t."branchId" IN (SELECT id FROM branches WHERE "companyId" = p_company_id))
  GROUP BY c.id, c.name
  ORDER BY SUM(ti.subtotal) DESC;
END;
$$;


-- ============================================================
-- VERIFY: List all new objects
-- ============================================================
-- SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname;
-- SELECT viewname FROM pg_views WHERE schemaname = 'public';
-- SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public';
