import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AccountingAgingQueryDto,
  AccountingDashboardQueryDto,
  AccountingDashboardResponse,
  AccountingAgingByPartyResponse,
  AccountingAgingDetailResponse,
  AccountingAgingReportResponse,
  BalanceSheetAccountResponse,
  BalanceSheetCategoryGroupResponse,
  BalanceSheetGroupResponse,
  BalanceSheetQueryDto,
  BalanceSheetResponse,
  CashFlowByTypeResponse,
  CashFlowItemResponse,
  CashFlowQueryDto,
  CashFlowResponse,
  ClosingChecklistResponse,
  CreateClosingEntriesResponse,
  DrillDownQueryDto,
  DrillDownResponse,
  EFakturExportQueryDto,
  EFakturExportResponse,
  GeneralLedgerQueryDto,
  GeneralLedgerResponse,
  IncomeStatementAccountResponse,
  IncomeStatementQueryDto,
  IncomeStatementResponse,
  LedgerEntryResponse,
  TaxSummaryDetailResponse,
  TaxSummaryQueryDto,
  TaxSummaryResponse,
  TrialBalanceQueryDto,
  TrialBalanceResponse,
  TrialBalanceRowResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

// ===========================
// HELPERS
// ===========================

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

function toDate(iso: string): Date {
  return new Date(iso);
}

function endOfDay(iso: string): Date {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

function dateToIso(d: Date | string): string {
  if (typeof d === "string") return d;
  return d.toISOString();
}

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================
  // 1. BUKU BESAR (General Ledger)
  // ===========================
  async getGeneralLedger(
    companyId: string,
    params: GeneralLedgerQueryDto,
  ): Promise<GeneralLedgerResponse> {
    const { accountId, dateFrom, dateTo, branchId } = params;

    const from = dateFrom ? toDate(dateFrom) : new Date("2000-01-01");
    const to = dateTo ? endOfDay(dateTo) : new Date("2099-12-31");

    const priorBranch = branchSQL(branchId, "je", 3);
    const entriesBranch = branchSQL(branchId, "je", 4);

    const [account, priorMovements, entries] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: accountId, category: { companyId } },
        include: { category: true },
      }),

      this.prisma.$queryRawUnsafe<{ totalDebit: number; totalCredit: number }[]>(
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
      ),

      this.prisma.$queryRawUnsafe<
        {
          date: Date;
          entryNumber: string;
          description: string;
          lineDescription: string | null;
          debit: number;
          credit: number;
        }[]
      >(
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
      ),
    ]);

    if (!account) throw new NotFoundException("Akun tidak ditemukan");

    const normalSide = account.category.normalSide;
    const priorDebit = priorMovements[0]?.totalDebit ?? 0;
    const priorCredit = priorMovements[0]?.totalCredit ?? 0;

    let openingBalance = account.openingBalance;
    if (normalSide === "DEBIT") {
      openingBalance += priorDebit - priorCredit;
    } else {
      openingBalance += priorCredit - priorDebit;
    }

    let runningBalance = openingBalance;
    const ledgerEntries: LedgerEntryResponse[] = entries.map((e) => {
      if (normalSide === "DEBIT") {
        runningBalance += e.debit - e.credit;
      } else {
        runningBalance += e.credit - e.debit;
      }
      return {
        date: dateToIso(e.date),
        entryNumber: e.entryNumber,
        description: e.lineDescription || e.description,
        lineDescription: e.lineDescription,
        debit: e.debit,
        credit: e.credit,
        runningBalance: Math.round(runningBalance * 100) / 100,
      };
    });

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        categoryType: account.category.type,
        categoryName: account.category.name,
        normalSide,
      },
      openingBalance,
      entries: ledgerEntries,
      closingBalance: Math.round(runningBalance * 100) / 100,
      totalDebit:
        Math.round(entries.reduce((s, e) => s + e.debit, 0) * 100) / 100,
      totalCredit:
        Math.round(entries.reduce((s, e) => s + e.credit, 0) * 100) / 100,
    };
  }

  // ===========================
  // 2. NERACA SALDO (Trial Balance)
  // ===========================
  async getTrialBalance(
    companyId: string,
    params: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResponse> {
    const { asOfDate, branchId } = params;
    const upTo = asOfDate ? endOfDay(asOfDate) : new Date("2099-12-31");

    const tbBranch = branchSQL(branchId, "je", 2);
    const acctBranchIdx = 2 + tbBranch.params.length + 1;
    const acctBranchCondition = branchId
      ? `AND (a."branchId" = $${acctBranchIdx} OR a."branchId" IS NULL)`
      : "";
    const acctBranchParams = branchId ? [branchId] : [];
    const companyIdx = 2 + tbBranch.params.length + acctBranchParams.length;

    const rows = await this.prisma.$queryRawUnsafe<
      {
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
      }[]
    >(
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

    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    const result: TrialBalanceRowResponse[] = rows.map((row) => {
      const { normalSide, openingBalance, totalDebit, totalCredit } = row;

      let netBalance = openingBalance;
      if (normalSide === "DEBIT") {
        netBalance += totalDebit - totalCredit;
      } else {
        netBalance += totalCredit - totalDebit;
      }

      let debit = 0;
      let credit = 0;

      if (netBalance >= 0) {
        if (normalSide === "DEBIT") debit = netBalance;
        else credit = netBalance;
      } else {
        if (normalSide === "DEBIT") credit = Math.abs(netBalance);
        else debit = Math.abs(netBalance);
      }

      grandTotalDebit += debit;
      grandTotalCredit += credit;

      return {
        accountId: row.accountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        categoryType: row.categoryType,
        categoryName: row.categoryName,
        normalSide,
        debit: Math.round(debit * 100) / 100,
        credit: Math.round(credit * 100) / 100,
      };
    });

    grandTotalDebit = Math.round(grandTotalDebit * 100) / 100;
    grandTotalCredit = Math.round(grandTotalCredit * 100) / 100;

    return {
      rows: result,
      totalDebit: grandTotalDebit,
      totalCredit: grandTotalCredit,
      isBalanced: Math.abs(grandTotalDebit - grandTotalCredit) < 0.01,
      difference: grandTotalDebit - grandTotalCredit,
      asOfDate: asOfDate ?? new Date().toISOString().split("T")[0]!,
    };
  }

  // ===========================
  // 3. LAPORAN LABA RUGI (Income Statement)
  // ===========================
  async getIncomeStatement(
    companyId: string,
    params: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResponse> {
    const { dateFrom, dateTo, branchId } = params;
    const from = toDate(dateFrom);
    const to = endOfDay(dateTo);
    const isBranch = branchSQL(branchId, "je", 3);
    const companyIdx = 3 + isBranch.params.length;

    const allRows = await this.prisma.$queryRawUnsafe<
      {
        accountId: string;
        code: string;
        name: string;
        type: string;
        amount: number;
      }[]
    >(
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

    const revenues: IncomeStatementAccountResponse[] = allRows
      .filter((r) => r.type === "REVENUE" && r.amount !== 0)
      .map((r) => ({
        accountId: r.accountId,
        accountCode: r.code,
        accountName: r.name,
        amount: r.amount,
      }));

    const expenses: IncomeStatementAccountResponse[] = allRows
      .filter((r) => r.type === "EXPENSE" && r.amount !== 0)
      .map((r) => ({
        accountId: r.accountId,
        accountCode: r.code,
        accountName: r.name,
        amount: r.amount,
      }));

    const totalRevenue =
      Math.round(revenues.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const totalExpense =
      Math.round(expenses.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const netIncome = Math.round((totalRevenue - totalExpense) * 100) / 100;

    return {
      period: { dateFrom, dateTo },
      revenues,
      totalRevenue,
      expenses,
      totalExpense,
      netIncome,
      isProfit: netIncome >= 0,
    };
  }

  // ===========================
  // 4. NERACA KEUANGAN (Balance Sheet)
  // ===========================
  async getBalanceSheet(
    companyId: string,
    params: BalanceSheetQueryDto,
  ): Promise<BalanceSheetResponse> {
    const { asOfDate, branchId } = params;
    const upTo = endOfDay(asOfDate);
    const bsBranch = branchSQL(branchId, "je", 2);
    const companyIdx = 2 + bsBranch.params.length;

    const [accountBalances, retainedEarningsResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        {
          accountId: string;
          code: string;
          name: string;
          categoryType: string;
          categoryName: string;
          normalSide: string;
          openingBalance: number;
          totalDebit: number;
          totalCredit: number;
        }[]
      >(
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
      ),

      this.prisma.$queryRawUnsafe<{ revenue: number; expense: number }[]>(
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
      ),
    ]);

    const retainedEarnings =
      Math.round(
        ((retainedEarningsResult[0]?.revenue ?? 0) -
          (retainedEarningsResult[0]?.expense ?? 0)) *
          100,
      ) / 100;

    const groupMap: Record<
      string,
      {
        categoryType: string;
        categoryName: string;
        accounts: BalanceSheetAccountResponse[];
        total: number;
      }
    > = {};

    for (const row of accountBalances) {
      let balance = row.openingBalance;
      if (row.normalSide === "DEBIT") {
        balance += row.totalDebit - row.totalCredit;
      } else {
        balance += row.totalCredit - row.totalDebit;
      }
      balance = Math.round(balance * 100) / 100;

      const key = `${row.categoryType}::${row.categoryName}`;
      if (!groupMap[key]) {
        groupMap[key] = {
          categoryType: row.categoryType,
          categoryName: row.categoryName,
          accounts: [],
          total: 0,
        };
      }

      if (balance !== 0) {
        groupMap[key]!.accounts.push({
          accountId: row.accountId,
          accountCode: row.code,
          accountName: row.name,
          balance,
        });
        groupMap[key]!.total += balance;
      }
    }

    const equityKey =
      Object.keys(groupMap).find((k) => k.startsWith("EQUITY::")) ??
      "EQUITY::Modal";
    if (!groupMap[equityKey]) {
      groupMap[equityKey] = {
        categoryType: "EQUITY",
        categoryName: "Modal",
        accounts: [],
        total: 0,
      };
    }
    if (retainedEarnings !== 0) {
      groupMap[equityKey]!.accounts.push({
        accountId: "retained-earnings",
        accountCode: "-",
        accountName: "Laba Ditahan",
        balance: retainedEarnings,
      });
      groupMap[equityKey]!.total += retainedEarnings;
    }

    const allGroups: BalanceSheetCategoryGroupResponse[] =
      Object.values(groupMap);
    const assetGroups = allGroups.filter((g) => g.categoryType === "ASSET");
    const liabilityGroups = allGroups.filter(
      (g) => g.categoryType === "LIABILITY",
    );
    const equityGroups = allGroups.filter((g) => g.categoryType === "EQUITY");

    const totalAssets =
      Math.round(assetGroups.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const totalLiabilities =
      Math.round(liabilityGroups.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const totalEquity =
      Math.round(equityGroups.reduce((s, g) => s + g.total, 0) * 100) / 100;
    const totalLiabilitiesAndEquity =
      Math.round((totalLiabilities + totalEquity) * 100) / 100;

    const assets: BalanceSheetGroupResponse = {
      categoryName: "Aset",
      accounts: assetGroups.flatMap((g) => g.accounts),
      total: totalAssets,
    };
    const liabilities: BalanceSheetGroupResponse = {
      categoryName: "Kewajiban",
      accounts: liabilityGroups.flatMap((g) => g.accounts),
      total: totalLiabilities,
    };
    const equity: BalanceSheetGroupResponse = {
      categoryName: "Ekuitas",
      accounts: equityGroups.flatMap((g) => g.accounts),
      total: totalEquity,
    };

    return {
      asOfDate,
      assets,
      liabilities,
      equity,
      assetGroups,
      liabilityGroups,
      equityGroups,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity,
      retainedEarnings,
      isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
      difference:
        Math.round((totalAssets - totalLiabilitiesAndEquity) * 100) / 100,
    };
  }

  // ===========================
  // 5. ARUS KAS (Cash Flow Statement)
  // ===========================
  async getCashFlow(
    companyId: string,
    params: CashFlowQueryDto,
  ): Promise<CashFlowResponse> {
    const { dateFrom, dateTo, branchId } = params;
    const from = toDate(dateFrom);
    const to = endOfDay(dateTo);

    const cfBranch = branchSQL(branchId, "je", 2);
    const cfRangeBranch = branchSQL(branchId, "je", 3);
    const companyIdxOpening = 2 + cfBranch.params.length;
    const companyIdxRange = 3 + cfRangeBranch.params.length;

    const [openingCashResult, cashMovements] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ balance: number }[]>(
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
            AND ac."companyId" = $${companyIdxOpening}
          `,
        from,
        ...cfBranch.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<
        {
          entryNumber: string;
          date: Date;
          description: string;
          lineDescription: string | null;
          debitAmount: number;
          creditAmount: number;
          referenceType: string | null;
        }[]
      >(
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
            AND ac."companyId" = $${companyIdxRange}
            ${cfRangeBranch.condition}
          ORDER BY je.date ASC, je."createdAt" ASC
          `,
        from,
        to,
        ...cfRangeBranch.params,
        companyId,
      ),
    ]);

    const openingCash = openingCashResult[0]?.balance ?? 0;

    const cashIn: CashFlowItemResponse[] = [];
    const cashOut: CashFlowItemResponse[] = [];

    for (const r of cashMovements) {
      const desc = r.lineDescription || r.description;
      if (r.debitAmount > 0) {
        cashIn.push({
          description: desc,
          amount: r.debitAmount,
          entryNumber: r.entryNumber,
          date: dateToIso(r.date),
        });
      }
      if (r.creditAmount > 0) {
        cashOut.push({
          description: desc,
          amount: r.creditAmount,
          entryNumber: r.entryNumber,
          date: dateToIso(r.date),
        });
      }
    }

    const totalCashIn =
      Math.round(cashIn.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const totalCashOut =
      Math.round(cashOut.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const netCashFlow = Math.round((totalCashIn - totalCashOut) * 100) / 100;
    const closingCash = Math.round((openingCash + netCashFlow) * 100) / 100;

    const cashInByType = summarizeCashByType(
      cashMovements
        .filter((r) => r.debitAmount > 0)
        .map((r) => ({ referenceType: r.referenceType, amount: r.debitAmount })),
    );
    const cashOutByType = summarizeCashByType(
      cashMovements
        .filter((r) => r.creditAmount > 0)
        .map((r) => ({
          referenceType: r.referenceType,
          amount: r.creditAmount,
        })),
    );

    return {
      period: { dateFrom, dateTo },
      openingCash,
      cashIn,
      totalCashIn,
      cashOut,
      totalCashOut,
      netCashFlow,
      closingCash,
      cashInByType,
      cashOutByType,
    };
  }

  // ===========================
  // 6. DASHBOARD AKUNTANSI
  // ===========================
  async getDashboard(
    companyId: string,
    params: AccountingDashboardQueryDto,
  ): Promise<AccountingDashboardResponse> {
    const { branchId } = params;
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const branchCond0 = branchSQL(branchId, "je", 1);
    const branchCond2 = branchSQL(branchId, "je", 3);
    const companyIdx0 = 1 + branchCond0.params.length;
    const companyIdx2 = 3 + branchCond2.params.length;

    const recentJournalInclude = {
      lines: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { sortOrder: "asc" as const },
      },
      createdByUser: { select: { name: true } },
    } as const;

    type RecentJournal = Prisma.JournalEntryGetPayload<{
      include: typeof recentJournalInclude;
    }>;

    const [
      cashBalance,
      receivableBalance,
      payableBalance,
      todayPnL,
      monthPnL,
      revenueTrend,
      topExpenses,
      recentJournals,
    ] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ balance: number }[]>(
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
          WHERE je.status = 'POSTED' ${branchCond0.condition}
          GROUP BY jel."accountId"
        ) mv ON mv."accountId" = a.id
        WHERE (a.code LIKE '1-1001%' OR a.code LIKE '1-1002%')
          AND a."isActive" = true
          AND ac."companyId" = $${companyIdx0}
        `,
        ...branchCond0.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<{ balance: number }[]>(
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
          WHERE je.status = 'POSTED' ${branchCond0.condition}
          GROUP BY jel."accountId"
        ) mv ON mv."accountId" = a.id
        WHERE a.code LIKE '1-1003%'
          AND a."isActive" = true
          AND ac."companyId" = $${companyIdx0}
        `,
        ...branchCond0.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<{ balance: number }[]>(
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
          WHERE je.status = 'POSTED' ${branchCond0.condition}
          GROUP BY jel."accountId"
        ) mv ON mv."accountId" = a.id
        WHERE ac.type = 'LIABILITY'
          AND a."isActive" = true
          AND ac."companyId" = $${companyIdx0}
        `,
        ...branchCond0.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<{ revenue: number; expense: number }[]>(
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
          AND ac."companyId" = $${companyIdx2}
          ${branchCond2.condition}
        `,
        todayStart,
        todayEnd,
        ...branchCond2.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<{ revenue: number; expense: number }[]>(
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
          AND ac."companyId" = $${companyIdx2}
          ${branchCond2.condition}
        `,
        monthStart,
        todayEnd,
        ...branchCond2.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<{ date: Date; revenue: number }[]>(
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
          AND ac."companyId" = $${companyIdx2}
          ${branchCond2.condition}
        GROUP BY je.date
        ORDER BY je.date ASC
        `,
        (() => {
          const d = new Date(todayStart);
          d.setDate(d.getDate() - 6);
          return d;
        })(),
        todayEnd,
        ...branchCond2.params,
        companyId,
      ),

      this.prisma.$queryRawUnsafe<
        { accountCode: string; accountName: string; amount: number }[]
      >(
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
          AND ac."companyId" = $${companyIdx2}
          ${branchCond2.condition}
        GROUP BY a.id, a.code, a.name
        HAVING SUM(jel.debit - jel.credit) > 0
        ORDER BY amount DESC
        LIMIT 5
        `,
        monthStart,
        todayEnd,
        ...branchCond2.params,
        companyId,
      ),

      this.prisma.journalEntry.findMany({
        where: {
          status: "POSTED",
          createdByUser: { companyId },
          ...(branchId ? { branchId } : {}),
        },
        include: recentJournalInclude,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 10,
      }),
    ] as const);

    const recentJournalsTyped = recentJournals as unknown as RecentJournal[];

    const todayRevenue = todayPnL[0]?.revenue ?? 0;
    const todayExpense = todayPnL[0]?.expense ?? 0;
    const monthRevenue = monthPnL[0]?.revenue ?? 0;
    const monthExpense = monthPnL[0]?.expense ?? 0;

    const trendMap = new Map(
      revenueTrend.map((r) => [
        new Date(r.date).toISOString().split("T")[0]!,
        r.revenue,
      ]),
    );
    const revenueTrendFilled: { date: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0]!;
      revenueTrendFilled.push({ date: key, revenue: trendMap.get(key) ?? 0 });
    }

    return {
      totalCash: cashBalance[0]?.balance ?? 0,
      totalReceivable: receivableBalance[0]?.balance ?? 0,
      totalPayable: payableBalance[0]?.balance ?? 0,
      todayProfit: todayRevenue - todayExpense,
      todayRevenue,
      todayExpense,
      monthProfit: monthRevenue - monthExpense,
      monthRevenue,
      monthExpense,
      revenueTrend: revenueTrendFilled,
      topExpenses,
      recentJournals: recentJournalsTyped.map((j) => ({
        id: j.id,
        entryNumber: j.entryNumber,
        date: dateToIso(j.date),
        description: j.description,
        totalDebit: j.totalDebit,
        totalCredit: j.totalCredit,
        referenceType: j.referenceType,
        createdBy: j.createdByUser.name,
        lines: j.lines.map((l) => ({
          accountCode: l.account.code,
          accountName: l.account.name,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
        })),
      })),
    };
  }

  // ============================================================
  // 7. TAX SUMMARY REPORT
  // ============================================================
  async getTaxSummary(
    companyId: string,
    params: TaxSummaryQueryDto,
  ): Promise<TaxSummaryResponse> {
    const {
      dateFrom,
      dateTo,
      branchId,
      taxType,
      search,
      page,
      perPage,
      sortBy,
      sortDir = "desc",
    } = params;
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const typeFilter =
      taxType && taxType !== "ALL" ? `AND jel."taxType" = '${taxType}'` : "";
    const searchFilter = search
      ? `AND (je."entryNumber" ILIKE '%${search}%' OR je.description ILIKE '%${search}%' OR je.reference ILIKE '%${search}%')`
      : "";

    // Whitelist sort columns to avoid SQL injection
    const sortColumnMap: Record<string, string> = {
      date: "je.date",
      entry_number: 'je."entryNumber"',
      tax_amount: 'jel."taxAmount"',
      dpp: 'jel."taxBaseAmount"',
    };
    const sortColumn =
      sortBy && sortColumnMap[sortBy]
        ? sortColumnMap[sortBy]
        : "je.date";
    const sortDirSql = sortDir === "asc" ? "ASC" : "DESC";

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        tax_type: string;
        total_tax: number;
        total_dpp: number;
        count: number;
      }>
    >(`
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

    const map = new Map(results.map((r) => [r.tax_type, r]));
    const ppnKeluaran = map.get("PPN_KELUARAN")?.total_tax ?? 0;
    const ppnMasukan = map.get("PPN_MASUKAN")?.total_tax ?? 0;
    const ppnKurangBayar = ppnKeluaran - ppnMasukan;

    const details = await this.prisma.$queryRawUnsafe<
      TaxSummaryDetailResponse[]
    >(`
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
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `);

    const countResult = await this.prisma.$queryRawUnsafe<[{ total: number }]>(`
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
    const total = Number(countResult[0]?.total ?? 0);

    return {
      period: { dateFrom, dateTo },
      ppnKeluaran,
      ppnMasukan,
      ppnKurangBayar,
      pph21: map.get("PPH21")?.total_tax ?? 0,
      pph23: map.get("PPH23")?.total_tax ?? 0,
      details,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getEFakturExport(
    companyId: string,
    params: EFakturExportQueryDto,
  ): Promise<EFakturExportResponse> {
    const { dateFrom, dateTo } = params;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        date: string;
        invoice: string;
        dpp: number;
        ppn: number;
        supplier_or_customer: string;
        reference_type: string;
      }>
    >(`
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

    const csvLines = [
      "FK,KD_JENIS_TRANSAKSI,FG_PENGGANTI,NOMOR_FAKTUR,MASA_PAJAK,TAHUN_PAJAK,TANGGAL_FAKTUR,DPP,PPN,KETERANGAN",
    ];
    rows.forEach((r) => {
      const d = new Date(r.date);
      const masa = (d.getMonth() + 1).toString();
      const tahun = d.getFullYear().toString();
      const tgl = `${d.getDate().toString().padStart(2, "0")}/${(
        d.getMonth() + 1
      )
        .toString()
        .padStart(2, "0")}/${d.getFullYear()}`;
      csvLines.push(
        `FK,01,0,${r.invoice},${masa},${tahun},${tgl},${Math.round(
          r.dpp,
        )},${Math.round(r.ppn)},"${r.supplier_or_customer.replace(
          /"/g,
          '""',
        )}"`,
      );
    });

    return {
      csv: csvLines.join("\n"),
      filename: `efaktur-${dateFrom}-${dateTo}.csv`,
    };
  }

  // ============================================================
  // 8. AP/AR AGING REPORT
  // ============================================================
  async getAging(
    companyId: string,
    params: AccountingAgingQueryDto,
  ): Promise<AccountingAgingReportResponse> {
    const { type, branchId, asOfDate } = params;
    const asOf = asOfDate ? `'${asOfDate}'::date` : "CURRENT_DATE";
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND d."branchId" = '${branchId}'` : "";

    const rows = await this.prisma.$queryRawUnsafe<
      AccountingAgingDetailResponse[]
    >(`
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

    const buckets = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0,
      noDueDate: 0,
    };
    for (const row of rows) {
      const amt = row.remaining_amount;
      if (row.aging_bucket === "CURRENT") buckets.current += amt;
      else if (row.aging_bucket === "1_30") buckets.days1to30 += amt;
      else if (row.aging_bucket === "31_60") buckets.days31to60 += amt;
      else if (row.aging_bucket === "61_90") buckets.days61to90 += amt;
      else if (row.aging_bucket === "OVER_90") buckets.over90 += amt;
      else buckets.noDueDate += amt;
    }
    const total =
      buckets.current +
      buckets.days1to30 +
      buckets.days31to60 +
      buckets.days61to90 +
      buckets.over90 +
      buckets.noDueDate;

    const byPartyMap = new Map<string, AccountingAgingByPartyResponse>();
    for (const row of rows) {
      const key = row.party_name;
      if (!byPartyMap.has(key))
        byPartyMap.set(key, {
          partyName: key,
          current: 0,
          days1to30: 0,
          days31to60: 0,
          days61to90: 0,
          over90: 0,
          noDueDate: 0,
          total: 0,
        });
      const entry = byPartyMap.get(key)!;
      const amt = row.remaining_amount;
      if (row.aging_bucket === "CURRENT") entry.current += amt;
      else if (row.aging_bucket === "1_30") entry.days1to30 += amt;
      else if (row.aging_bucket === "31_60") entry.days31to60 += amt;
      else if (row.aging_bucket === "61_90") entry.days61to90 += amt;
      else if (row.aging_bucket === "OVER_90") entry.over90 += amt;
      else entry.noDueDate += amt;
      entry.total += amt;
    }

    return {
      type,
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      summary: { ...buckets, total },
      details: rows,
      byParty: Array.from(byPartyMap.values()).sort(
        (a, b) => b.total - a.total,
      ),
    };
  }

  // ============================================================
  // 9. REPORT DRILL-DOWN
  // ============================================================
  async getDrillDown(
    companyId: string,
    params: DrillDownQueryDto,
  ): Promise<DrillDownResponse> {
    const { accountId, dateFrom, dateTo, branchId, page, perPage } = params;
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

    const [rows, countResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<
        Array<{
          journal_id: string;
          entry_number: string;
          date: string;
          description: string;
          reference: string;
          reference_type: string;
          debit: number;
          credit: number;
        }>
      >(`
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
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
      `),
      this.prisma.$queryRawUnsafe<[{ total: number }]>(`
        SELECT COUNT(*)::int AS total
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        JOIN accounts a ON a.id = jel."accountId"
        JOIN account_categories ac ON ac.id = a."categoryId"
        WHERE jel."accountId" = '${accountId}'
          AND je.status = 'POSTED'
          AND ac."companyId" = '${companyId}'
          ${dateFilter} ${branchFilter}
      `),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    return {
      entries: rows,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  // ============================================================
  // 10. PERIOD-END CLOSING
  // ============================================================
  async getClosingChecklist(
    companyId: string,
    periodId: string,
  ): Promise<ClosingChecklistResponse> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) return { error: "Periode tidak ditemukan" };

    const dateFrom = period.startDate.toISOString().slice(0, 10);
    const dateTo = period.endDate.toISOString().slice(0, 10);

    const draftCount = await this.prisma.journalEntry.count({
      where: {
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
        date: { gte: period.startDate, lte: period.endDate },
        branch: { companyId },
      },
    });

    const tbResult = await this.prisma.$queryRawUnsafe<
      [{ total_debit: number; total_credit: number }]
    >(`
      SELECT
        COALESCE(SUM(jel.debit), 0)::float AS total_debit,
        COALESCE(SUM(jel.credit), 0)::float AS total_credit
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED' AND je.date <= '${dateTo}' AND ac."companyId" = '${companyId}'
    `);
    const tbDiff = Math.abs(
      (tbResult[0]?.total_debit ?? 0) - (tbResult[0]?.total_credit ?? 0),
    );

    const txnWithoutJournal = await this.prisma.$queryRawUnsafe<
      [{ count: number }]
    >(`
      SELECT COUNT(*)::int AS count FROM transactions t
      WHERE t."companyId" = '${companyId}' AND t.status = 'COMPLETED'
        AND t."createdAt" >= '${dateFrom}' AND t."createdAt" <= '${dateTo} 23:59:59'
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je."referenceType" = 'TRANSACTION' AND je."referenceId" = t.id)
    `);

    const checks = [
      {
        key: "no_draft_journals",
        label: "Tidak ada jurnal Draft/Pending",
        passed: draftCount === 0,
        count: draftCount,
      },
      {
        key: "trial_balance_balanced",
        label: "Neraca Saldo seimbang",
        passed: tbDiff < 0.01,
        difference: tbDiff,
      },
      {
        key: "all_transactions_journaled",
        label: "Semua transaksi sudah dijurnal",
        passed: (txnWithoutJournal[0]?.count ?? 0) === 0,
        missing: txnWithoutJournal[0]?.count ?? 0,
      },
    ];

    return {
      period: {
        id: period.id,
        name: period.name,
        dateFrom,
        dateTo,
        status: period.status,
      },
      checks,
      allPassed: checks.every((c) => c.passed),
    };
  }

  async createClosingEntries(
    companyId: string,
    userId: string,
    periodId: string,
  ): Promise<CreateClosingEntriesResponse> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) return { error: "Periode tidak ditemukan" };
    if (period.status !== "OPEN")
      return { error: "Periode harus berstatus OPEN" };

    const dateFrom = period.startDate.toISOString().slice(0, 10);
    const dateTo = period.endDate.toISOString().slice(0, 10);

    const incomeRows = await this.prisma.$queryRawUnsafe<
      Array<{
        account_id: string;
        account_code: string;
        account_name: string;
        cat_type: string;
        amount: number;
      }>
    >(`
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

    if (incomeRows.length === 0)
      return { error: "Tidak ada revenue/expense untuk ditutup" };

    const retainedEarnings = await this.prisma.account.findFirst({
      where: { code: { startsWith: "3-1002" }, category: { companyId } },
    });
    if (!retainedEarnings)
      return { error: "Akun Laba Ditahan (3-1002) tidak ditemukan" };

    const closingLines: {
      accountId: string;
      description: string;
      debit: number;
      credit: number;
    }[] = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const row of incomeRows) {
      if (row.cat_type === "REVENUE" && row.amount > 0) {
        closingLines.push({
          accountId: row.account_id,
          description: `Tutup ${row.account_name}`,
          debit: row.amount,
          credit: 0,
        });
        totalRevenue += row.amount;
      } else if (row.cat_type === "EXPENSE" && row.amount > 0) {
        closingLines.push({
          accountId: row.account_id,
          description: `Tutup ${row.account_name}`,
          debit: 0,
          credit: row.amount,
        });
        totalExpense += row.amount;
      }
    }

    const netIncome = totalRevenue - totalExpense;
    if (netIncome > 0) {
      closingLines.push({
        accountId: retainedEarnings.id,
        description: "Laba periode berjalan",
        debit: 0,
        credit: netIncome,
      });
    } else if (netIncome < 0) {
      closingLines.push({
        accountId: retainedEarnings.id,
        description: "Rugi periode berjalan",
        debit: Math.abs(netIncome),
        credit: 0,
      });
    }

    const today = new Date();
    const prefix = `JV-${today.getFullYear().toString().slice(-2)}${(
      today.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}${today.getDate().toString().padStart(2, "0")}`;
    const last = await this.prisma.journalEntry.findFirst({
      where: { entryNumber: { startsWith: prefix } },
      orderBy: { entryNumber: "desc" },
      select: { entryNumber: true },
    });
    let seq = 1;
    if (last) {
      const s = parseInt(last.entryNumber.split("-")[2] ?? "0");
      if (!isNaN(s)) seq = s + 1;
    }
    const entryNumber = `${prefix}-${String(seq).padStart(4, "0")}`;

    const totalDebit = closingLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = closingLines.reduce((s, l) => s + l.credit, 0);

    await this.prisma.$transaction([
      this.prisma.journalEntry.create({
        data: {
          entryNumber,
          date: period.endDate,
          description: `Jurnal Penutup â€” ${period.name}`,
          reference: `CLOSING-${period.name}`,
          referenceType: "CLOSING",
          branchId: null,
          periodId,
          status: "POSTED",
          totalDebit,
          totalCredit,
          createdBy: userId,
          notes: `Auto-generated closing entry for period ${period.name}`,
          lines: { create: closingLines.map((l, i) => ({ ...l, sortOrder: i })) },
        },
      }),
      this.prisma.accountingPeriod.update({
        where: { id: periodId },
        data: { status: "CLOSED", closedBy: userId, closedAt: new Date() },
      }),
    ]);

    return { success: true, entryNumber, netIncome };
  }
}

function summarizeCashByType(
  rows: { referenceType: string | null; amount: number }[],
): CashFlowByTypeResponse[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const type = r.referenceType || "LAINNYA";
    map.set(type, (map.get(type) ?? 0) + r.amount);
  }

  const labels: Record<string, string> = {
    TRANSACTION: "Penjualan",
    PURCHASE: "Pembelian",
    RETURN: "Retur",
    DEBT_PAYMENT: "Pembayaran Hutang/Piutang",
    EXPENSE: "Pengeluaran Operasional",
    MANUAL: "Jurnal Manual",
    LAINNYA: "Lainnya",
  };

  return Array.from(map.entries()).map(([type, amount]) => ({
    type,
    description: labels[type] ?? type,
    amount: Math.round(amount * 100) / 100,
  }));
}
