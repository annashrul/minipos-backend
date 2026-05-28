import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  AccountingAgingQuerySchema,
  AccountingDashboardQuerySchema,
  BalanceSheetQuerySchema,
  CashFlowQuerySchema,
  ClosingChecklistQuerySchema,
  CreateClosingEntriesSchema,
  DrillDownQuerySchema,
  EFakturExportQuerySchema,
  GeneralLedgerQuerySchema,
  IncomeStatementQuerySchema,
  TaxSummaryQuerySchema,
  TrialBalanceQuerySchema,
  type AccountingAgingQueryDto,
  type AccountingDashboardQueryDto,
  type BalanceSheetQueryDto,
  type CashFlowQueryDto,
  type ClosingChecklistQueryDto,
  type CreateClosingEntriesDto,
  type DrillDownQueryDto,
  type EFakturExportQueryDto,
  type GeneralLedgerQueryDto,
  type IncomeStatementQueryDto,
  type TaxSummaryQueryDto,
  type TrialBalanceQueryDto,
} from "./dto/accounting-reports.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { AccountingReportsService } from "./accounting-reports.service";

@ApiTags("Accounting Reports")
@ApiBearerAuth()
@Controller("accounting-reports")
@UseGuards(AccessGuard)
export class AccountingReportsController {
  constructor(private readonly reports: AccountingReportsService) {}

  @Get("general-ledger")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "General ledger report" })
  @ApiZodQuery(GeneralLedgerQuerySchema)
  async generalLedger(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(GeneralLedgerQuerySchema))
    query: GeneralLedgerQueryDto,
  ) {
    const data = await this.reports.getGeneralLedger(companyId, query);
    return { data };
  }

  @Get("trial-balance")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Trial balance report" })
  @ApiZodQuery(TrialBalanceQuerySchema)
  async trialBalance(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(TrialBalanceQuerySchema))
    query: TrialBalanceQueryDto,
  ) {
    const data = await this.reports.getTrialBalance(companyId, query);
    return { data };
  }

  @Get("income-statement")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Income statement report" })
  @ApiZodQuery(IncomeStatementQuerySchema)
  async incomeStatement(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(IncomeStatementQuerySchema))
    query: IncomeStatementQueryDto,
  ) {
    const data = await this.reports.getIncomeStatement(companyId, query);
    return { data };
  }

  @Get("balance-sheet")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Balance sheet report" })
  @ApiZodQuery(BalanceSheetQuerySchema)
  async balanceSheet(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(BalanceSheetQuerySchema))
    query: BalanceSheetQueryDto,
  ) {
    const data = await this.reports.getBalanceSheet(companyId, query);
    return { data };
  }

  @Get("cash-flow")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Cash flow report" })
  @ApiZodQuery(CashFlowQuerySchema)
  async cashFlow(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(CashFlowQuerySchema))
    query: CashFlowQueryDto,
  ) {
    const data = await this.reports.getCashFlow(companyId, query);
    return { data };
  }

  @Get("dashboard")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Accounting dashboard summary" })
  @ApiZodQuery(AccountingDashboardQuerySchema)
  async dashboard(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AccountingDashboardQuerySchema))
    query: AccountingDashboardQueryDto,
  ) {
    const data = await this.reports.getDashboard(companyId, query);
    return { data };
  }

  @Get("tax-summary")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Tax summary report" })
  @ApiZodQuery(TaxSummaryQuerySchema)
  async taxSummary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(TaxSummaryQuerySchema))
    query: TaxSummaryQueryDto,
  ) {
    const data = await this.reports.getTaxSummary(companyId, query);
    return { data };
  }

  @Get("efaktur-export")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Export e-Faktur data" })
  @ApiZodQuery(EFakturExportQuerySchema)
  async efakturExport(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(EFakturExportQuerySchema))
    query: EFakturExportQueryDto,
  ) {
    const data = await this.reports.getEFakturExport(companyId, query);
    return { data };
  }

  @Get("aging")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Aging report" })
  @ApiZodQuery(AccountingAgingQuerySchema)
  async aging(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AccountingAgingQuerySchema))
    query: AccountingAgingQueryDto,
  ) {
    const data = await this.reports.getAging(companyId, query);
    return { data };
  }

  @Get("drill-down")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Drill down report data" })
  @ApiZodQuery(DrillDownQuerySchema)
  async drillDown(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(DrillDownQuerySchema))
    query: DrillDownQueryDto,
  ) {
    const data = await this.reports.getDrillDown(companyId, query);
    return { data };
  }

  @Get("closing-checklist")
  @RequireAccess("accounting-reports", "view")
  @ApiOperation({ summary: "Period closing checklist" })
  @ApiZodQuery(ClosingChecklistQuerySchema)
  async closingChecklist(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ClosingChecklistQuerySchema))
    query: ClosingChecklistQueryDto,
  ) {
    const data = await this.reports.getClosingChecklist(
      companyId,
      query.periodId,
    );
    return { data };
  }

  @Post("closing-entries")
  @RequireAccess("accounting-reports", "create")
  @ApiOperation({ summary: "Create period closing entries" })
  @ApiZodBody(CreateClosingEntriesSchema)
  async createClosingEntries(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateClosingEntriesSchema))
    body: CreateClosingEntriesDto,
  ) {
    const data = await this.reports.createClosingEntries(
      companyId,
      user.id,
      body.periodId,
    );
    return { data };
  }
}
