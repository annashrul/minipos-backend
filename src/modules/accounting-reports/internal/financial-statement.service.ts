import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AccountingDashboardQueryDto,
  AccountingDashboardResponse,
  BalanceSheetAccountResponse,
  BalanceSheetCategoryGroupResponse,
  BalanceSheetGroupResponse,
  BalanceSheetQueryDto,
  BalanceSheetResponse,
  CashFlowByTypeResponse,
  CashFlowItemResponse,
  CashFlowQueryDto,
  CashFlowResponse,
  IncomeStatementAccountResponse,
  IncomeStatementQueryDto,
  IncomeStatementResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  branchSQL,
  dateToIso,
  endOfDay,
  summarizeCashByType,
  toDate,
} from "./accounting-reports.helpers";

@Injectable()
export class FinancialStatementService {
  constructor(private readonly prisma: PrismaService) {}

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
}
