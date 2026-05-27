import { Injectable } from "@nestjs/common";
import { round2 } from "@/common/utils/math";
import type {
  BalanceSheetAccountResponse,
  BalanceSheetCategoryGroupResponse,
  BalanceSheetGroupResponse,
  BalanceSheetQueryDto,
  BalanceSheetResponse,
  CashFlowItemResponse,
  CashFlowQueryDto,
  CashFlowResponse,
  IncomeStatementAccountResponse,
  IncomeStatementQueryDto,
  IncomeStatementResponse,
} from "./dto/accounting-reports.dto";
import { AccountingReportsRepository } from "./accounting-reports.repository";
import { dateToIso, summarizeCashByType } from "./helpers/accounting-reports.helpers";

@Injectable()
export class IncomeBalanceSheetService {
  constructor(
    private readonly repo: AccountingReportsRepository,
  ) {}

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
}
