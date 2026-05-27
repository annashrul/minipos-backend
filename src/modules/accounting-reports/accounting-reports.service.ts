import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toDateOnly } from "@/common/utils/date";
import { round2 } from "@/common/utils/math";
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
  TaxSummaryQueryDto,
  TaxSummaryResponse,
  TrialBalanceQueryDto,
  TrialBalanceResponse,
  TrialBalanceRowResponse,
} from "./dto/accounting-reports.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { AccountingReportsRepository } from "./accounting-reports.repository";

// ===========================
// HELPERS
// ===========================

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountingReportsRepository,
  ) {}

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

    const [account, priorMovements, entries] = await Promise.all([
      this.repo.findAccountWithCategory(accountId, companyId),
      this.repo.findPriorMovements(accountId, from, branchId),
      this.repo.findLedgerEntries(accountId, from, to, branchId),
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
  // 3. LAPORAN LABA RUGI (Income Statement)
  // ===========================
  async getIncomeStatement(
    companyId: string,
    params: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResponse> {
    const { dateFrom, dateTo, branchId } = params;

    const allRows = await this.repo.findIncomeStatementRows(
      dateFrom,
      dateTo,
      branchId,
      companyId,
    );

    const revenues: IncomeStatementAccountResponse[] = [];
    const expenses: IncomeStatementAccountResponse[] = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    for (const r of allRows) {
      if (r.amount === 0) continue;
      const item: IncomeStatementAccountResponse = {
        accountId: r.accountId,
        accountCode: r.code,
        accountName: r.name,
        amount: r.amount,
      };
      if (r.type === "REVENUE") {
        revenues.push(item);
        totalRevenue += r.amount;
      } else if (r.type === "EXPENSE") {
        expenses.push(item);
        totalExpense += r.amount;
      }
    }

    totalRevenue = round2(totalRevenue);
    totalExpense = round2(totalExpense);
    const netIncome = round2(totalRevenue - totalExpense);

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

    const [accountBalances, retainedEarningsResult] = await Promise.all([
      this.repo.findBalanceSheetAccounts(asOfDate, branchId, companyId),
      this.repo.findRetainedEarnings(asOfDate, branchId, companyId),
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
      balance = round2(balance);

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

    const assetGroups: BalanceSheetCategoryGroupResponse[] = [];
    const liabilityGroups: BalanceSheetCategoryGroupResponse[] = [];
    const equityGroups: BalanceSheetCategoryGroupResponse[] = [];

    for (const group of Object.values(groupMap)) {
      if (group.categoryType === "ASSET") assetGroups.push(group);
      else if (group.categoryType === "LIABILITY") liabilityGroups.push(group);
      else if (group.categoryType === "EQUITY") equityGroups.push(group);
    }

    const totalAssets =
      round2(assetGroups.reduce((s, g) => s + g.total, 0));
    const totalLiabilities =
      round2(liabilityGroups.reduce((s, g) => s + g.total, 0));
    const totalEquity =
      round2(equityGroups.reduce((s, g) => s + g.total, 0));
    const totalLiabilitiesAndEquity =
      round2(totalLiabilities + totalEquity);

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
        round2(totalAssets - totalLiabilitiesAndEquity),
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

    const [openingCashResult, cashMovements] = await Promise.all([
      this.repo.findOpeningCashBalance(dateFrom, branchId, companyId),
      this.repo.findCashMovements(dateFrom, dateTo, branchId, companyId),
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
      round2(cashIn.reduce((s, i) => s + i.amount, 0));
    const totalCashOut =
      round2(cashOut.reduce((s, i) => s + i.amount, 0));
    const netCashFlow = round2(totalCashIn - totalCashOut);
    const closingCash = round2(openingCash + netCashFlow);

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

    const [results, details, countResult] = await Promise.all([
      this.repo.findTaxSummaryAgg(dateFrom, dateTo, branchId, companyId),
      this.repo.findTaxSummaryDetails(
        dateFrom,
        dateTo,
        branchId,
        companyId,
        taxType,
        search,
        sortColumn,
        sortDirSql,
        perPage,
        (page - 1) * perPage,
      ),
      this.repo.findTaxSummaryCount(
        dateFrom,
        dateTo,
        branchId,
        companyId,
        taxType,
        search,
      ),
    ]);

    const map = new Map(results.map((r) => [r.tax_type, r]));
    const ppnKeluaran = map.get("PPN_KELUARAN")?.total_tax ?? 0;
    const ppnMasukan = map.get("PPN_MASUKAN")?.total_tax ?? 0;
    const ppnKurangBayar = ppnKeluaran - ppnMasukan;

    const total = Number(countResult[0]?.total ?? 0);

    return {
      period: { dateFrom, dateTo },
      ppnKeluaran,
      ppnMasukan,
      ppnKurangBayar,
      pph21: map.get("PPH21")?.total_tax ?? 0,
      pph23: map.get("PPH23")?.total_tax ?? 0,
      details: details as unknown as import("./dto/accounting-reports.dto").TaxSummaryDetailResponse[],
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getEFakturExport(
    companyId: string,
    params: EFakturExportQueryDto,
  ): Promise<EFakturExportResponse> {
    const { dateFrom, dateTo } = params;

    const rows = await this.repo.findEFakturRows(dateFrom, dateTo, companyId);

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

    const rows = await this.repo.findAgingDetails(
      type,
      companyId,
      branchId,
      asOfDate,
    );

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
      asOfDate: asOfDate || toDateOnly(new Date()),
      summary: { ...buckets, total },
      details: rows as unknown as AccountingAgingDetailResponse[],
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
    const period = await this.repo.findAccountingPeriod(periodId, companyId);
    if (!period) return { error: "Periode tidak ditemukan" };

    const dateFrom = toDateOnly(period.startDate);
    const dateTo = toDateOnly(period.endDate);

    const [draftCount, tbResult, txnWithoutJournal] = await Promise.all([
      this.repo.countDraftJournals(
        period.startDate,
        period.endDate,
        companyId,
      ),
      this.repo.findTBCheck(dateTo, companyId),
      this.repo.findTxnWithoutJournal(companyId, dateFrom, dateTo),
    ]);

    const tbDiff = Math.abs(
      (tbResult[0]?.total_debit ?? 0) - (tbResult[0]?.total_credit ?? 0),
    );

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
    const period = await this.repo.findAccountingPeriod(periodId, companyId);
    if (!period) return { error: "Periode tidak ditemukan" };
    if (period.status !== "OPEN")
      return { error: "Periode harus berstatus OPEN" };

    const dateFrom = toDateOnly(period.startDate);
    const dateTo = toDateOnly(period.endDate);

    const incomeRows = await this.repo.findIncomeClosingRows(
      companyId,
      dateFrom,
      dateTo,
    );

    if (incomeRows.length === 0)
      return { error: "Tidak ada revenue/expense untuk ditutup" };

    const retainedEarnings = await this.repo.findRetainedEarningsAccount(
      companyId,
    );
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
    const last = await this.repo.findLastEntryNumber(prefix);
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
          description: `Jurnal Penutup — ${period.name}`,
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
    amount: round2(amount),
  }));
}
