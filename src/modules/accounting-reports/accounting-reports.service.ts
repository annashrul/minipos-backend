import { Injectable } from "@nestjs/common";
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
  TaxSummaryQueryDto,
  TaxSummaryResponse,
  TrialBalanceQueryDto,
  TrialBalanceResponse,
} from "@/contracts";
import { FinancialStatementService } from "./internal/financial-statement.service";
import { LedgerService } from "./internal/ledger.service";
import { PeriodClosingService } from "./internal/period-closing.service";
import { TaxComplianceService } from "./internal/tax-compliance.service";

/**
 * Facade tipis. Delegasi ke 4 service per-domain laporan akuntansi:
 *  - LedgerService              → general ledger, trial balance, drill-down
 *  - FinancialStatementService  → income statement, balance sheet, cash flow, dashboard
 *  - TaxComplianceService       → tax summary (PPN keluaran/masukan), efaktur export
 *  - PeriodClosingService       → aging A/R-A/P, closing checklist, closing entries
 */
@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly statements: FinancialStatementService,
    private readonly tax: TaxComplianceService,
    private readonly closing: PeriodClosingService,
  ) {}

  // Ledger
  getGeneralLedger(
    companyId: string,
    params: GeneralLedgerQueryDto,
  ): Promise<GeneralLedgerResponse> {
    return this.ledger.getGeneralLedger(companyId, params);
  }
  getTrialBalance(
    companyId: string,
    params: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResponse> {
    return this.ledger.getTrialBalance(companyId, params);
  }
  getDrillDown(
    companyId: string,
    params: DrillDownQueryDto,
  ): Promise<DrillDownResponse> {
    return this.ledger.getDrillDown(companyId, params);
  }

  // Financial statements
  getIncomeStatement(
    companyId: string,
    params: IncomeStatementQueryDto,
  ): Promise<IncomeStatementResponse> {
    return this.statements.getIncomeStatement(companyId, params);
  }
  getBalanceSheet(
    companyId: string,
    params: BalanceSheetQueryDto,
  ): Promise<BalanceSheetResponse> {
    return this.statements.getBalanceSheet(companyId, params);
  }
  getCashFlow(
    companyId: string,
    params: CashFlowQueryDto,
  ): Promise<CashFlowResponse> {
    return this.statements.getCashFlow(companyId, params);
  }
  getDashboard(
    companyId: string,
    params: AccountingDashboardQueryDto,
  ): Promise<AccountingDashboardResponse> {
    return this.statements.getDashboard(companyId, params);
  }

  // Tax
  getTaxSummary(
    companyId: string,
    params: TaxSummaryQueryDto,
  ): Promise<TaxSummaryResponse> {
    return this.tax.getTaxSummary(companyId, params);
  }
  getEFakturExport(
    companyId: string,
    params: EFakturExportQueryDto,
  ): Promise<EFakturExportResponse> {
    return this.tax.getEFakturExport(companyId, params);
  }

  // Period closing
  getAging(
    companyId: string,
    params: AccountingAgingQueryDto,
  ): Promise<AccountingAgingReportResponse> {
    return this.closing.getAging(companyId, params);
  }
  getClosingChecklist(
    companyId: string,
    periodId: string,
  ): Promise<ClosingChecklistResponse> {
    return this.closing.getClosingChecklist(companyId, periodId);
  }
  createClosingEntries(
    companyId: string,
    userId: string,
    periodId: string,
  ): Promise<CreateClosingEntriesResponse> {
    return this.closing.createClosingEntries(companyId, userId, periodId);
  }
}
