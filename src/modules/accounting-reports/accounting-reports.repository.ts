import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── Helpers ─────────────────────────────────────────────────────────

function branchSQL(
  branchId: string | undefined,
  alias: string | undefined,
  paramIndex: number,
): { condition: string; params: unknown[] } {
  if (!branchId) return { condition: "", params: [] };
  const prefix = alias ? `${alias}.` : "";
  return {
    condition: ` AND ${prefix}"branchId" = $${paramIndex}`,
    params: [branchId],
  };
}

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDate(iso: string): Date {
  return new Date(iso);
}

// ── Raw SQL row types ────────────────────────────────────────────────

export type RawPriorMovementRow = {
  totalDebit: number;
  totalCredit: number;
};

export type RawLedgerEntryRow = {
  date: Date;
  entryNumber: string;
  description: string;
  lineDescription: string | null;
  debit: number;
  credit: number;
};

export type RawTrialBalanceRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  categoryType: string;
  categoryName: string;
  normalSide: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  isActive: boolean;
};

export type RawIncomeStatementRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  amount: number;
};

export type RawBalanceSheetAccountRow = {
  accountId: string;
  code: string;
  name: string;
  categoryType: string;
  categoryName: string;
  normalSide: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
};

export type RawRetainedEarningsRow = {
  revenue: number;
  expense: number;
};

export type RawCashBalanceRow = {
  balance: number;
};

export type RawCashMovementRow = {
  entryNumber: string;
  date: Date;
  description: string;
  lineDescription: string | null;
  debitAmount: number;
  creditAmount: number;
  referenceType: string | null;
};

export type RawPnLRow = {
  revenue: number;
  expense: number;
};

export type RawRevenueTrendRow = {
  date: Date;
  revenue: number;
};

export type RawTopExpenseRow = {
  accountCode: string;
  accountName: string;
  amount: number;
};

export type RawTaxSummaryAggRow = {
  tax_type: string;
  total_tax: number;
  total_dpp: number;
  count: number;
};

export type RawTaxSummaryDetailRow = {
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  tax_type: string;
  tax_amount: number;
  dpp: number;
  reference_type: string;
};

export type RawEFakturRow = {
  date: string;
  invoice: string;
  dpp: number;
  ppn: number;
  supplier_or_customer: string;
  reference_type: string;
};

export type RawAgingDetailRow = {
  id: string;
  party_name: string;
  party_type: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  due_date: string;
  created_at: string;
  reference_type: string;
  description: string;
  aging_bucket: string;
  days_past_due: number;
};

export type RawDrillDownRow = {
  journal_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  reference_type: string;
  debit: number;
  credit: number;
};

export type RawCountRow = {
  total: number;
};

export type RawTBCheckRow = {
  total_debit: number;
  total_credit: number;
};

export type RawTxnMissingRow = {
  count: number;
};

export type RawIncomeClosingRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  cat_type: string;
  amount: number;
};

@Injectable()
export class AccountingReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── 1. General Ledger ────────────────────────────────────────────

  findAccountWithCategory(accountId: string, companyId: string) {
    return this.prisma.account.findFirst({
      where: { id: accountId, category: { companyId } },
      include: { category: true },
    });
  }

  findPriorMovements(
    accountId: string,
    from: Date,
    branchId: string | undefined,
  ): Promise<RawPriorMovementRow[]> {
    const priorBranch = branchSQL(branchId, "je", 3);
    return this.prisma.$queryRawUnsafe<RawPriorMovementRow[]>(
      `
      SELECT
        COALESCE(SUM(jel.debit), 0)::float AS "totalDebit",
        COALESCE(SUM(jel.credit), 0)::float AS "totalCredit"
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      WHERE jel."accountId" = $1
        AND je.status = 'POSTED'
        AND je.date < $2
        ${priorBranch.condition}
      `,
      accountId,
      from,
      ...priorBranch.params,
    );
  }

  findLedgerEntries(
    accountId: string,
    from: Date,
    to: Date,
    branchId: string | undefined,
  ): Promise<RawLedgerEntryRow[]> {
    const entriesBranch = branchSQL(branchId, "je", 4);
    return this.prisma.$queryRawUnsafe<RawLedgerEntryRow[]>(
      `
      SELECT
        je.date,
        je."entryNumber",
        je.description,
        jel.description AS "lineDescription",
        jel.debit::float AS debit,
        jel.credit::float AS credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      WHERE jel."accountId" = $1
        AND je.status = 'POSTED'
        AND je.date >= $2
        AND je.date <= $3
        ${entriesBranch.condition}
      ORDER BY je.date ASC, je."createdAt" ASC
      `,
      accountId,
      from,
      to,
      ...entriesBranch.params,
    );
  }

  // ── 2. Trial Balance ─────────────────────────────────────────────

  findTrialBalanceRows(
    asOfDate: string | undefined,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawTrialBalanceRow[]> {
    const upTo = asOfDate ? endOfDay(asOfDate) : new Date("2099-12-31");
    const tbBranch = branchSQL(branchId, "je", 2);
    const acctBranchIdx = 2 + tbBranch.params.length + 1;
    const acctBranchCondition = branchId
      ? `AND (a."branchId" = $${acctBranchIdx} OR a."branchId" IS NULL)`
      : "";
    const acctBranchParams = branchId ? [branchId] : [];
    const companyIdx = 2 + tbBranch.params.length + acctBranchParams.length;

    return this.prisma.$queryRawUnsafe<RawTrialBalanceRow[]>(
      `
      SELECT
        a.id AS "accountId",
        a.code AS "accountCode",
        a.name AS "accountName",
        ac.type AS "categoryType",
        ac.name AS "categoryName",
        ac."normalSide",
        a."openingBalance"::float AS "openingBalance",
        COALESCE(SUM(jel.debit), 0)::float AS "totalDebit",
        COALESCE(SUM(jel.credit), 0)::float AS "totalCredit"
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN journal_entry_lines jel ON jel."accountId" = a.id
      LEFT JOIN journal_entries je ON je.id = jel."journalId"
        AND je.status = 'POSTED'
        AND je.date <= $1
        ${tbBranch.condition}
      WHERE a."isActive" = true
        AND ac."companyId" = $${companyIdx}
        ${acctBranchCondition}
      GROUP BY a.id, a.code, a.name, ac.type, ac.name, ac."normalSide", a."openingBalance"
      ORDER BY a.code ASC
      `,
      upTo,
      ...tbBranch.params,
      ...acctBranchParams,
      companyId,
    );
  }

  // ── 3. Income Statement ──────────────────────────────────────────

  findIncomeStatementRows(
    dateFrom: string,
    dateTo: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawIncomeStatementRow[]> {
    const from = toDate(dateFrom);
    const to = endOfDay(dateTo);
    const isBranch = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + isBranch.params.length;

    return this.prisma.$queryRawUnsafe<RawIncomeStatementRow[]>(
      `
      SELECT
        a.id AS "accountId",
        a.code,
        a.name,
        ac.type,
        CASE
          WHEN ac.type = 'REVENUE' THEN (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0))
          WHEN ac.type = 'EXPENSE' THEN (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))
        END::float AS amount
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN journal_entry_lines jel ON jel."accountId" = a.id
      LEFT JOIN journal_entries je ON je.id = jel."journalId"
        AND je.status = 'POSTED'
        AND je.date >= $1
        AND je.date <= $2
        ${isBranch.condition}
      WHERE ac.type IN ('REVENUE', 'EXPENSE')
        AND a."isActive" = true
        AND ac."companyId" = $${companyIdx}
      GROUP BY a.id, a.code, a.name, ac.type
      ORDER BY a.code ASC
      `,
      from,
      to,
      ...isBranch.params,
      companyId,
    );
  }

  // ── 4. Balance Sheet ─────────────────────────────────────────────

  findBalanceSheetAccounts(
    asOfDate: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawBalanceSheetAccountRow[]> {
    const upTo = endOfDay(asOfDate);
    const bsBranch = branchSQL(branchId, "je", 2);
    const companyIdx = 2 + bsBranch.params.length;

    return this.prisma.$queryRawUnsafe<RawBalanceSheetAccountRow[]>(
      `
      SELECT
        a.id AS "accountId",
        a.code,
        a.name,
        ac.type AS "categoryType",
        ac.name AS "categoryName",
        ac."normalSide",
        a."openingBalance"::float AS "openingBalance",
        COALESCE(SUM(jel.debit), 0)::float AS "totalDebit",
        COALESCE(SUM(jel.credit), 0)::float AS "totalCredit"
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN journal_entry_lines jel ON jel."accountId" = a.id
      LEFT JOIN journal_entries je ON je.id = jel."journalId"
        AND je.status = 'POSTED'
        AND je.date <= $1
        ${bsBranch.condition}
      WHERE a."isActive" = true
        AND ac.type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND ac."companyId" = $${companyIdx}
      GROUP BY a.id, a.code, a.name, ac.type, ac.name, ac."normalSide", a."openingBalance"
      ORDER BY a.code ASC
      `,
      upTo,
      ...bsBranch.params,
      companyId,
    );
  }

  findRetainedEarnings(
    asOfDate: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawRetainedEarningsRow[]> {
    const upTo = endOfDay(asOfDate);
    const bsBranch = branchSQL(branchId, "je", 2);
    const companyIdx = 2 + bsBranch.params.length;

    return this.prisma.$queryRawUnsafe<RawRetainedEarningsRow[]>(
      `
      SELECT
        COALESCE(SUM(CASE WHEN ac.type = 'REVENUE' THEN jel.credit - jel.debit ELSE 0 END), 0)::float AS revenue,
        COALESCE(SUM(CASE WHEN ac.type = 'EXPENSE' THEN jel.debit - jel.credit ELSE 0 END), 0)::float AS expense
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND je.date <= $1
        AND ac.type IN ('REVENUE', 'EXPENSE')
        AND ac."companyId" = $${companyIdx}
        ${bsBranch.condition}
      `,
      upTo,
      ...bsBranch.params,
      companyId,
    );
  }

  // ── 5. Cash Flow ─────────────────────────────────────────────────

  findOpeningCashBalance(
    dateFrom: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawCashBalanceRow[]> {
    const from = toDate(dateFrom);
    const cfBranch = branchSQL(branchId, "je", 2);
    const companyIdx = 2 + cfBranch.params.length;

    return this.prisma.$queryRawUnsafe<RawCashBalanceRow[]>(
      `
      SELECT
        COALESCE(SUM(
          a."openingBalance" + COALESCE(mv."totalDebit", 0) - COALESCE(mv."totalCredit", 0)
        ), 0)::float AS balance
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN (
        SELECT
          jel."accountId",
          SUM(jel.debit)::float AS "totalDebit",
          SUM(jel.credit)::float AS "totalCredit"
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        WHERE je.status = 'POSTED'
          AND je.date < $1
          ${cfBranch.condition}
        GROUP BY jel."accountId"
      ) mv ON mv."accountId" = a.id
      WHERE ac.type = 'ASSET'
        AND (a.code LIKE '1-1001%' OR a.code LIKE '1-1002%')
        AND a."isActive" = true
        AND ac."companyId" = $${companyIdx}
      `,
      from,
      ...cfBranch.params,
      companyId,
    );
  }

  findCashMovements(
    dateFrom: string,
    dateTo: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawCashMovementRow[]> {
    const from = toDate(dateFrom);
    const to = endOfDay(dateTo);
    const cfRangeBranch = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + cfRangeBranch.params.length;

    return this.prisma.$queryRawUnsafe<RawCashMovementRow[]>(
      `
      SELECT
        je."entryNumber",
        je.date,
        je.description,
        jel.description AS "lineDescription",
        jel.debit::float AS "debitAmount",
        jel.credit::float AS "creditAmount",
        je."referenceType"
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND je.date >= $1
        AND je.date <= $2
        AND (a.code LIKE '1-1001%' OR a.code LIKE '1-1002%')
        AND (jel.debit > 0 OR jel.credit > 0)
        AND ac."companyId" = $${companyIdx}
        ${cfRangeBranch.condition}
      ORDER BY je.date ASC, je."createdAt" ASC
      `,
      from,
      to,
      ...cfRangeBranch.params,
      companyId,
    );
  }

  // ── 6. Dashboard ─────────────────────────────────────────────────

  findCashBalance(
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawCashBalanceRow[]> {
    const branchCond = branchSQL(branchId, "je", 1);
    const companyIdx = 1 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawCashBalanceRow[]>(
      `
      SELECT COALESCE(SUM(
        a."openingBalance" + COALESCE(mv.net, 0)
      ), 0)::float AS balance
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN (
        SELECT jel."accountId", SUM(jel.debit - jel.credit)::float AS net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        WHERE je.status = 'POSTED' ${branchCond.condition}
        GROUP BY jel."accountId"
      ) mv ON mv."accountId" = a.id
      WHERE (a.code LIKE '1-1001%' OR a.code LIKE '1-1002%')
        AND a."isActive" = true
        AND ac."companyId" = $${companyIdx}
      `,
      ...branchCond.params,
      companyId,
    );
  }

  findReceivableBalance(
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawCashBalanceRow[]> {
    const branchCond = branchSQL(branchId, "je", 1);
    const companyIdx = 1 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawCashBalanceRow[]>(
      `
      SELECT COALESCE(SUM(
        a."openingBalance" + COALESCE(mv.net, 0)
      ), 0)::float AS balance
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN (
        SELECT jel."accountId", SUM(jel.debit - jel.credit)::float AS net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        WHERE je.status = 'POSTED' ${branchCond.condition}
        GROUP BY jel."accountId"
      ) mv ON mv."accountId" = a.id
      WHERE a.code LIKE '1-1003%'
        AND a."isActive" = true
        AND ac."companyId" = $${companyIdx}
      `,
      ...branchCond.params,
      companyId,
    );
  }

  findPayableBalance(
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawCashBalanceRow[]> {
    const branchCond = branchSQL(branchId, "je", 1);
    const companyIdx = 1 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawCashBalanceRow[]>(
      `
      SELECT COALESCE(SUM(
        a."openingBalance" + COALESCE(mv.net, 0)
      ), 0)::float AS balance
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN (
        SELECT jel."accountId", SUM(jel.credit - jel.debit)::float AS net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        WHERE je.status = 'POSTED' ${branchCond.condition}
        GROUP BY jel."accountId"
      ) mv ON mv."accountId" = a.id
      WHERE ac.type = 'LIABILITY'
        AND a."isActive" = true
        AND ac."companyId" = $${companyIdx}
      `,
      ...branchCond.params,
      companyId,
    );
  }

  findPnL(
    dateStart: Date,
    dateEnd: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawPnLRow[]> {
    const branchCond = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawPnLRow[]>(
      `
      SELECT
        COALESCE(SUM(CASE WHEN ac.type = 'REVENUE' THEN jel.credit - jel.debit ELSE 0 END), 0)::float AS revenue,
        COALESCE(SUM(CASE WHEN ac.type = 'EXPENSE' THEN jel.debit - jel.credit ELSE 0 END), 0)::float AS expense
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND je.date >= $1 AND je.date < $2
        AND ac.type IN ('REVENUE', 'EXPENSE')
        AND ac."companyId" = $${companyIdx}
        ${branchCond.condition}
      `,
      dateStart,
      dateEnd,
      ...branchCond.params,
      companyId,
    );
  }

  findRevenueTrend(
    dateStart: Date,
    dateEnd: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawRevenueTrendRow[]> {
    const branchCond = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawRevenueTrendRow[]>(
      `
      SELECT
        je.date,
        COALESCE(SUM(jel.credit - jel.debit), 0)::float AS revenue
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND ac.type = 'REVENUE'
        AND je.date >= $1
        AND je.date < $2
        AND ac."companyId" = $${companyIdx}
        ${branchCond.condition}
      GROUP BY je.date
      ORDER BY je.date ASC
      `,
      dateStart,
      dateEnd,
      ...branchCond.params,
      companyId,
    );
  }

  findTopExpenses(
    dateStart: Date,
    dateEnd: Date,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawTopExpenseRow[]> {
    const branchCond = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + branchCond.params.length;

    return this.prisma.$queryRawUnsafe<RawTopExpenseRow[]>(
      `
      SELECT
        a.code AS "accountCode",
        a.name AS "accountName",
        COALESCE(SUM(jel.debit - jel.credit), 0)::float AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND ac.type = 'EXPENSE'
        AND je.date >= $1 AND je.date < $2
        AND ac."companyId" = $${companyIdx}
        ${branchCond.condition}
      GROUP BY a.id, a.code, a.name
      HAVING SUM(jel.debit - jel.credit) > 0
      ORDER BY amount DESC
      LIMIT 5
      `,
      dateStart,
      dateEnd,
      ...branchCond.params,
      companyId,
    );
  }

  findRecentJournals(companyId: string, branchId: string | undefined) {
    return this.prisma.journalEntry.findMany({
      where: {
        status: "POSTED",
        createdByUser: { companyId },
        ...(branchId ? { branchId } : {}),
      },
      include: {
        lines: {
          include: { account: { select: { code: true, name: true } } },
          orderBy: { sortOrder: "asc" as const },
        },
        createdByUser: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 10,
    });
  }

  // ── 7. Tax Summary ───────────────────────────────────────────────

  findTaxSummaryAgg(
    dateFrom: string,
    dateTo: string,
    branchId: string | undefined,
    companyId: string,
  ): Promise<RawTaxSummaryAggRow[]> {
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";

    return this.prisma.$queryRawUnsafe<RawTaxSummaryAggRow[]>(`
      SELECT
        jel."taxType" AS tax_type,
        COALESCE(SUM(COALESCE(jel."taxAmount", 0)), 0)::float AS total_tax,
        COALESCE(SUM(COALESCE(jel."taxBaseAmount", 0)), 0)::float AS total_dpp,
        COUNT(*)::int AS count
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
      GROUP BY jel."taxType"
    `);
  }

  findTaxSummaryDetails(
    dateFrom: string,
    dateTo: string,
    branchId: string | undefined,
    companyId: string,
    taxType: string | undefined,
    search: string | undefined,
    sortColumn: string,
    sortDirSql: string,
    perPage: number,
    offset: number,
  ): Promise<RawTaxSummaryDetailRow[]> {
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const typeFilter =
      taxType && taxType !== "ALL" ? `AND jel."taxType" = '${taxType}'` : "";
    const searchFilter = search
      ? `AND (je."entryNumber" ILIKE '%${search}%' OR je.description ILIKE '%${search}%' OR je.reference ILIKE '%${search}%')`
      : "";

    return this.prisma.$queryRawUnsafe<RawTaxSummaryDetailRow[]>(`
      SELECT
        je."entryNumber" AS entry_number, je.date::text, je.description,
        COALESCE(je.reference, '') AS reference,
        jel."taxType" AS tax_type,
        COALESCE(jel."taxAmount", 0)::float AS tax_amount,
        COALESCE(jel."taxBaseAmount", 0)::float AS dpp,
        COALESCE(je."referenceType", 'MANUAL') AS reference_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
        ${typeFilter}
        ${searchFilter}
      ORDER BY ${sortColumn} ${sortDirSql}
      LIMIT ${perPage} OFFSET ${offset}
    `);
  }

  findTaxSummaryCount(
    dateFrom: string,
    dateTo: string,
    branchId: string | undefined,
    companyId: string,
    taxType: string | undefined,
    search: string | undefined,
  ): Promise<RawCountRow[]> {
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const typeFilter =
      taxType && taxType !== "ALL" ? `AND jel."taxType" = '${taxType}'` : "";
    const searchFilter = search
      ? `AND (je."entryNumber" ILIKE '%${search}%' OR je.description ILIKE '%${search}%' OR je.reference ILIKE '%${search}%')`
      : "";

    return this.prisma.$queryRawUnsafe<RawCountRow[]>(`
      SELECT COUNT(*)::int AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
        ${typeFilter}
        ${searchFilter}
    `);
  }

  // ── E-Faktur ─────────────────────────────────────────────────────

  findEFakturRows(
    dateFrom: string,
    dateTo: string,
    companyId: string,
  ): Promise<RawEFakturRow[]> {
    return this.prisma.$queryRawUnsafe<RawEFakturRow[]>(`
      SELECT
        je.date::text, COALESCE(je.reference, je."entryNumber") AS invoice,
        COALESCE(jel."taxBaseAmount", 0)::float AS dpp,
        COALESCE(jel."taxAmount", 0)::float AS ppn,
        COALESCE(je.description, '') AS supplier_or_customer,
        COALESCE(je."referenceType", 'MANUAL') AS reference_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IN ('PPN_KELUARAN', 'PPN_MASUKAN')
        AND je.date >= '${dateFrom}' AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
      ORDER BY je.date ASC
    `);
  }

  // ── 8. AP/AR Aging ───────────────────────────────────────────────

  findAgingDetails(
    type: string,
    companyId: string,
    branchId: string | undefined,
    asOfDate: string | undefined,
  ): Promise<RawAgingDetailRow[]> {
    const asOf = asOfDate ? `'${asOfDate}'::date` : "CURRENT_DATE";
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND d."branchId" = '${branchId}'` : "";

    return this.prisma.$queryRawUnsafe<RawAgingDetailRow[]>(`
      SELECT
        d.id, d."partyName" AS party_name, d."partyType" AS party_type,
        d."totalAmount"::float AS total_amount, d."paidAmount"::float AS paid_amount,
        d."remainingAmount"::float AS remaining_amount,
        d."dueDate"::text AS due_date, d."createdAt"::text AS created_at,
        COALESCE(d."referenceType", '') AS reference_type,
        COALESCE(d.description, '') AS description,
        CASE
          WHEN d."dueDate" IS NULL THEN 'NO_DUE_DATE'
          WHEN d."dueDate" >= ${asOf} THEN 'CURRENT'
          WHEN d."dueDate" >= ${asOf} - INTERVAL '30 days' THEN '1_30'
          WHEN d."dueDate" >= ${asOf} - INTERVAL '60 days' THEN '31_60'
          WHEN d."dueDate" >= ${asOf} - INTERVAL '90 days' THEN '61_90'
          ELSE 'OVER_90'
        END AS aging_bucket,
        GREATEST(0, EXTRACT(DAY FROM ${asOf} - d."dueDate"))::int AS days_past_due
      FROM debts d
      WHERE d.type = '${type}'
        AND d.status IN ('UNPAID', 'PARTIAL')
        AND d."companyId" = '${companyId}'
        ${branchFilter}
      ORDER BY d."dueDate" ASC NULLS LAST
    `);
  }

  // ── 9. Drill-Down ────────────────────────────────────────────────

  findDrillDownRows(
    accountId: string,
    companyId: string,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    branchId: string | undefined,
    perPage: number,
    offset: number,
  ): Promise<RawDrillDownRow[]> {
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const dateFilter =
      dateFrom && dateTo
        ? `AND je.date >= '${dateFrom}' AND je.date <= '${dateTo}'`
        : dateFrom
          ? `AND je.date >= '${dateFrom}'`
          : dateTo
            ? `AND je.date <= '${dateTo}'`
            : "";

    return this.prisma.$queryRawUnsafe<RawDrillDownRow[]>(`
      SELECT je.id AS journal_id, je."entryNumber" AS entry_number, je.date::text,
        je.description, COALESCE(je.reference, '') AS reference,
        COALESCE(je."referenceType", 'MANUAL') AS reference_type,
        jel.debit::float, jel.credit::float
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE jel."accountId" = '${accountId}'
        AND je.status = 'POSTED'
        AND ac."companyId" = '${companyId}'
        ${dateFilter} ${branchFilter}
      ORDER BY je.date DESC, je."createdAt" DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);
  }

  findDrillDownCount(
    accountId: string,
    companyId: string,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    branchId: string | undefined,
  ): Promise<RawCountRow[]> {
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const dateFilter =
      dateFrom && dateTo
        ? `AND je.date >= '${dateFrom}' AND je.date <= '${dateTo}'`
        : dateFrom
          ? `AND je.date >= '${dateFrom}'`
          : dateTo
            ? `AND je.date <= '${dateTo}'`
            : "";

    return this.prisma.$queryRawUnsafe<RawCountRow[]>(`
      SELECT COUNT(*)::int AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE jel."accountId" = '${accountId}'
        AND je.status = 'POSTED'
        AND ac."companyId" = '${companyId}'
        ${dateFilter} ${branchFilter}
    `);
  }

  // ── 10. Period-End Closing ───────────────────────────────────────

  findAccountingPeriod(periodId: string, companyId: string) {
    return this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, companyId },
    });
  }

  countDraftJournals(
    startDate: Date,
    endDate: Date,
    companyId: string,
  ) {
    return this.prisma.journalEntry.count({
      where: {
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
        date: { gte: startDate, lte: endDate },
        branch: { companyId },
      },
    });
  }

  findTBCheck(
    dateTo: string,
    companyId: string,
  ): Promise<RawTBCheckRow[]> {
    return this.prisma.$queryRawUnsafe<RawTBCheckRow[]>(`
      SELECT
        COALESCE(SUM(jel.debit), 0)::float AS total_debit,
        COALESCE(SUM(jel.credit), 0)::float AS total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED' AND je.date <= '${dateTo}' AND ac."companyId" = '${companyId}'
    `);
  }

  findTxnWithoutJournal(
    companyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<RawTxnMissingRow[]> {
    return this.prisma.$queryRawUnsafe<RawTxnMissingRow[]>(`
      SELECT COUNT(*)::int AS count FROM transactions t
      WHERE t."companyId" = '${companyId}' AND t.status = 'COMPLETED'
        AND t."createdAt" >= '${dateFrom}' AND t."createdAt" <= '${dateTo} 23:59:59'
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je."referenceType" = 'TRANSACTION' AND je."referenceId" = t.id)
    `);
  }

  findIncomeClosingRows(
    companyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<RawIncomeClosingRow[]> {
    return this.prisma.$queryRawUnsafe<RawIncomeClosingRow[]>(`
      SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name, ac.type AS cat_type,
        CASE
          WHEN ac.type = 'REVENUE' THEN (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0))::float
          WHEN ac.type = 'EXPENSE' THEN (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))::float
        END AS amount
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN journal_entry_lines jel ON jel."accountId" = a.id
      LEFT JOIN journal_entries je ON je.id = jel."journalId" AND je.status = 'POSTED' AND je.date >= '${dateFrom}' AND je.date <= '${dateTo}'
      WHERE ac.type IN ('REVENUE', 'EXPENSE') AND a."isActive" = true AND ac."companyId" = '${companyId}'
      GROUP BY a.id, a.code, a.name, ac.type
      HAVING CASE WHEN ac.type = 'REVENUE' THEN COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0) ELSE COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) END > 0
    `);
  }

  findRetainedEarningsAccount(companyId: string) {
    return this.prisma.account.findFirst({
      where: { code: { startsWith: "3-1002" }, category: { companyId } },
    });
  }

  findLastEntryNumber(prefix: string) {
    return this.prisma.journalEntry.findFirst({
      where: { entryNumber: { startsWith: prefix } },
      orderBy: { entryNumber: "desc" },
      select: { entryNumber: true },
    });
  }
}
