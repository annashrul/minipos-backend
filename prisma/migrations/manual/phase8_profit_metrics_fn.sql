-- phase8_profit_metrics_fn.sql
-- (Re)create fn_get_profit_metrics with TIMESTAMPTZ parameters so that
-- Prisma's $queryRawUnsafe(date1, date2, ...) matches without casting.
-- Drop both possible signatures first to avoid overload ambiguity.

DROP FUNCTION IF EXISTS public.fn_get_profit_metrics(TIMESTAMP, TIMESTAMP, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_get_profit_metrics(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);

CREATE FUNCTION public.fn_get_profit_metrics(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
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
  -- Aggregate expenses (date column is DATE, range matched on calendar boundary)
  SELECT COALESCE(SUM(e.amount), 0)
  INTO v_expense
  FROM public.expenses e
  WHERE e.date >= p_start::date
    AND e.date <  p_end::date
    AND (p_branch_id IS NULL OR e."branchId" = p_branch_id OR e."branchId" IS NULL)
    AND (
      p_company_id IS NULL
      OR e."branchId" IN (SELECT id FROM public.branches WHERE "companyId" = p_company_id)
    );

  RETURN QUERY
  SELECT
    COALESCE(SUM(t."grandTotal"), 0)::DOUBLE PRECISION                                       AS revenue,
    COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)::DOUBLE PRECISION                      AS cogs,
    (COALESCE(SUM(t."grandTotal"), 0)
       - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0))::DOUBLE PRECISION                AS gross_profit,
    COALESCE(SUM(t."discountAmount"), 0)::DOUBLE PRECISION                                   AS discount,
    COALESCE(SUM(t."taxAmount"), 0)::DOUBLE PRECISION                                        AS tax,
    v_expense                                                                                AS expense,
    (COALESCE(SUM(t."grandTotal"), 0)
       - COALESCE(SUM(ti.quantity * p."purchasePrice"), 0)
       - v_expense)::DOUBLE PRECISION                                                        AS net_profit,
    COUNT(DISTINCT t.id)::BIGINT                                                             AS transaction_count,
    COALESCE(SUM(ti.quantity), 0)::BIGINT                                                    AS items_sold
  FROM public.transactions t
  JOIN public.transaction_items ti ON ti."transactionId" = t.id
  JOIN public.products p           ON p.id = ti."productId"
  WHERE t.status = 'COMPLETED'
    AND t."createdAt" >= p_start
    AND t."createdAt" <  p_end
    AND (p_branch_id IS NULL OR t."branchId" = p_branch_id)
    AND (
      p_company_id IS NULL
      OR t."branchId" IN (SELECT id FROM public.branches WHERE "companyId" = p_company_id)
    );
END;
$$;
