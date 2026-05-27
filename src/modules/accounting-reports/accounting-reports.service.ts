import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toDateOnly } from "@/common/utils/date";
import { round2 } from "@/common/utils/math";
import { paginate } from "@/common/utils/pagination";
import type {
  AccountingAgingQueryDto,
  AccountingAgingReportResponse,
  AccountingDashboardQueryDto,
  AccountingDashboardResponse,
  BalanceSheetQueryDto,
  BalanceSheetResponse,
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
  IncomeStatementQueryDto,
  IncomeStatementResponse,
  LedgerEntryResponse,
  TaxSummaryQueryDto,
  TaxSummaryResponse,
  TrialBalanceQueryDto,
  TrialBalanceResponse,
  TrialBalanceRowResponse,
} from "./dto/accounting-reports.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { AccountingReportsRepository } from "./accounting-reports.repository";
import { IncomeBalanceSheetService } from "./income-balance-sheet.service";
import { TaxAgingService } from "./tax-aging.service";
import { dateToIso } from "./helpers/accounting-reports.helpers";

@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountingReportsRepository,
    private readonly incomeBalanceSheet: IncomeBalanceSheetService,
    private readonly taxAging: TaxAgingService,
  ) {}

  // ===========================
  // 1. BUKU BESAR (General Ledger)
  // ===========================
  async getGeneralLedger(
    companyId: string,
    params: GeneralLedgerQueryDto,
  ): Promise<GeneralLedgerResponse> {
    const { accountId, dateFrom, dateTo, branchId } = params;

    const from = dateFrom ? new Date(dateFrom) : new Date("2000-01-01");
    const toEnd = dateTo
      ? (() => { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); return d; })()
      : new Date("2099-12-31");

    const [account, priorMovements, entries] = await Promise.all([
      this.repo.findAccountWithCategory(accountId, companyId),
      this.repo.findPriorMovements(accountId, from, branchId),
      this.repo.findLedgerEntries(accountId, from, toEnd, branchId),
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
    let totalDebit = 0;
    let totalCredit = 0;
    const ledgerEntries: LedgerEntryResponse[] = entries.map((e) => {
      totalDebit += e.debit;
      totalCredit += e.credit;
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
        runningBalance: round2(runningBalance),
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
      closingBalance: round2(runningBalance),
      totalDebit: round2(totalDebit),
      totalCredit: round2(totalCredit),
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

    const rows = await this.repo.findTrialBalanceRows(
      asOfDate,
      branchId,
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
        debit: round2(debit),
        credit: round2(credit),
      };
    });

    grandTotalDebit = round2(grandTotalDebit);
    grandTotalCredit = round2(grandTotalCredit);

    return {
      rows: result,
      totalDebit: grandTotalDebit,
      totalCredit: grandTotalCredit,
      isBalanced: Math.abs(grandTotalDebit - grandTotalCredit) < 0.01,
      difference: grandTotalDebit - grandTotalCredit,
      asOfDate: asOfDate ?? toDateOnly(new Date()),
    };
  }

  // ===========================
  // 3-5. Delegated: Income Statement, Balance Sheet, Cash Flow
  // ===========================

  async getIncomeStatement(
    companyId: string,
    params: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResponse> {
    return this.incomeBalanceSheet.getIncomeStatement(companyId, params);
  }

  async getBalanceSheet(
    companyId: string,
    params: BalanceSheetQueryDto,
  ): Promise<BalanceSheetResponse> {
    return this.incomeBalanceSheet.getBalanceSheet(companyId, params);
  }

  async getCashFlow(
    companyId: string,
    params: CashFlowQueryDto,
  ): Promise<CashFlowResponse> {
    return this.incomeBalanceSheet.getCashFlow(companyId, params);
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

    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

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
      this.repo.findCashBalance(branchId, companyId),
      this.repo.findReceivableBalance(branchId, companyId),
      this.repo.findPayableBalance(branchId, companyId),
      this.repo.findPnL(todayStart, todayEnd, branchId, companyId),
      this.repo.findPnL(monthStart, todayEnd, branchId, companyId),
      this.repo.findRevenueTrend(sevenDaysAgo, todayEnd, branchId, companyId),
      this.repo.findTopExpenses(monthStart, todayEnd, branchId, companyId),
      this.repo.findRecentJournals(companyId, branchId),
    ] as const);

    const recentJournalsTyped = recentJournals as unknown as RecentJournal[];

    const todayRevenue = todayPnL[0]?.revenue ?? 0;
    const todayExpense = todayPnL[0]?.expense ?? 0;
    const monthRevenue = monthPnL[0]?.revenue ?? 0;
    const monthExpense = monthPnL[0]?.expense ?? 0;

    const trendMap = new Map(
      revenueTrend.map((r) => [
        toDateOnly(r.date),
        r.revenue,
      ]),
    );
    const revenueTrendFilled: { date: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() - i);
      const key = toDateOnly(d);
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

  // ===========================
  // 7-8, 10. Delegated: Tax, Aging, Closing
  // ===========================

  async getTaxSummary(
    companyId: string,
    params: TaxSummaryQueryDto,
  ): Promise<TaxSummaryResponse> {
    return this.taxAging.getTaxSummary(companyId, params);
  }

  async getEFakturExport(
    companyId: string,
    params: EFakturExportQueryDto,
  ): Promise<EFakturExportResponse> {
    return this.taxAging.getEFakturExport(companyId, params);
  }

  async getAging(
    companyId: string,
    params: AccountingAgingQueryDto,
  ): Promise<AccountingAgingReportResponse> {
    return this.taxAging.getAging(companyId, params);
  }

  // ============================================================
  // 9. REPORT DRILL-DOWN
  // ============================================================
  async getDrillDown(
    companyId: string,
    params: DrillDownQueryDto,
  ): Promise<DrillDownResponse> {
    const { accountId, dateFrom, dateTo, branchId, page, perPage } = params;

    const [rows, countResult] = await Promise.all([
      this.repo.findDrillDownRows(
        accountId,
        companyId,
        dateFrom,
        dateTo,
        branchId,
        perPage,
        (page - 1) * perPage,
      ),
      this.repo.findDrillDownCount(
        accountId,
        companyId,
        dateFrom,
        dateTo,
        branchId,
      ),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    return paginate(rows, total, page, perPage);
  }

  // ============================================================
  // 10. Delegated: Period-End Closing
  // ============================================================

  async getClosingChecklist(
    companyId: string,
    periodId: string,
  ): Promise<ClosingChecklistResponse> {
    return this.taxAging.getClosingChecklist(companyId, periodId);
  }

  async createClosingEntries(
    companyId: string,
    userId: string,
    periodId: string,
  ): Promise<CreateClosingEntriesResponse> {
    return this.taxAging.createClosingEntries(companyId, userId, periodId);
  }
}
