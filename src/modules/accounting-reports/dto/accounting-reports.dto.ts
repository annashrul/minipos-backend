import { z } from "zod";

// =============================================
// Query Schemas
// =============================================

export const GeneralLedgerQuerySchema = z.object({
  accountId: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  branchId: z.string().optional(),
});
export type GeneralLedgerQueryDto = z.infer<typeof GeneralLedgerQuerySchema>;

export const TrialBalanceQuerySchema = z.object({
  asOfDate: z.string().optional(),
  branchId: z.string().optional(),
});
export type TrialBalanceQueryDto = z.infer<typeof TrialBalanceQuerySchema>;

export const IncomeStatementQuerySchema = z.object({
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  branchId: z.string().optional(),
  period: z.string().optional(),
});
export type IncomeStatementQueryDto = z.infer<typeof IncomeStatementQuerySchema>;

export const BalanceSheetQuerySchema = z.object({
  asOfDate: z.string().min(1),
  branchId: z.string().optional(),
});
export type BalanceSheetQueryDto = z.infer<typeof BalanceSheetQuerySchema>;

export const CashFlowQuerySchema = z.object({
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  branchId: z.string().optional(),
});
export type CashFlowQueryDto = z.infer<typeof CashFlowQuerySchema>;

export const AccountingDashboardQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type AccountingDashboardQueryDto = z.infer<
  typeof AccountingDashboardQuerySchema
>;

export const TaxSummaryQuerySchema = z.object({
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  branchId: z.string().optional(),
  taxType: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(10),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type TaxSummaryQueryDto = z.infer<typeof TaxSummaryQuerySchema>;

export const EFakturExportQuerySchema = z.object({
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
});
export type EFakturExportQueryDto = z.infer<typeof EFakturExportQuerySchema>;

export const AccountingAgingQuerySchema = z.object({
  type: z.enum(["PAYABLE", "RECEIVABLE"]),
  branchId: z.string().optional(),
  asOfDate: z.string().optional(),
});
export type AccountingAgingQueryDto = z.infer<typeof AccountingAgingQuerySchema>;

export const DrillDownQuerySchema = z.object({
  accountId: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  branchId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type DrillDownQueryDto = z.infer<typeof DrillDownQuerySchema>;

export const ClosingChecklistQuerySchema = z.object({
  periodId: z.string().min(1),
});
export type ClosingChecklistQueryDto = z.infer<
  typeof ClosingChecklistQuerySchema
>;

export const CreateClosingEntriesSchema = z.object({
  periodId: z.string().min(1),
});
export type CreateClosingEntriesDto = z.infer<typeof CreateClosingEntriesSchema>;

// =============================================
// Response Types
// =============================================

export type LedgerEntryResponse = {
  date: string;
  entryNumber: string;
  description: string;
  lineDescription: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type GeneralLedgerResponse = {
  account: {
    id: string;
    code: string;
    name: string;
    categoryType: string;
    categoryName: string;
    normalSide: string;
  };
  openingBalance: number;
  entries: LedgerEntryResponse[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
};

export type TrialBalanceRowResponse = {
  accountId: string;
  accountCode: string;
  accountName: string;
  categoryType: string;
  categoryName: string;
  normalSide: string;
  debit: number;
  credit: number;
};

export type TrialBalanceResponse = {
  rows: TrialBalanceRowResponse[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  difference: number;
  asOfDate: string;
};

export type IncomeStatementAccountResponse = {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
};

export type IncomeStatementResponse = {
  period: { dateFrom: string; dateTo: string };
  revenues: IncomeStatementAccountResponse[];
  totalRevenue: number;
  expenses: IncomeStatementAccountResponse[];
  totalExpense: number;
  netIncome: number;
  isProfit: boolean;
};

export type BalanceSheetAccountResponse = {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: number;
};

export type BalanceSheetGroupResponse = {
  categoryName: string;
  accounts: BalanceSheetAccountResponse[];
  total: number;
};

export type BalanceSheetCategoryGroupResponse = {
  categoryType: string;
  categoryName: string;
  accounts: BalanceSheetAccountResponse[];
  total: number;
};

export type BalanceSheetResponse = {
  asOfDate: string;
  assets: BalanceSheetGroupResponse;
  liabilities: BalanceSheetGroupResponse;
  equity: BalanceSheetGroupResponse;
  assetGroups: BalanceSheetCategoryGroupResponse[];
  liabilityGroups: BalanceSheetCategoryGroupResponse[];
  equityGroups: BalanceSheetCategoryGroupResponse[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  retainedEarnings: number;
  isBalanced: boolean;
  difference: number;
};

export type CashFlowItemResponse = {
  description: string;
  amount: number;
  entryNumber?: string;
  date?: string;
};

export type CashFlowByTypeResponse = {
  type: string;
  description: string;
  amount: number;
};

export type CashFlowResponse = {
  period: { dateFrom: string; dateTo: string };
  openingCash: number;
  cashIn: CashFlowItemResponse[];
  totalCashIn: number;
  cashOut: CashFlowItemResponse[];
  totalCashOut: number;
  netCashFlow: number;
  closingCash: number;
  cashInByType: CashFlowByTypeResponse[];
  cashOutByType: CashFlowByTypeResponse[];
};

export type DashboardJournalLineResponse = {
  accountCode: string;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
};

export type DashboardJournalResponse = {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  referenceType: string | null;
  createdBy: string;
  lines: DashboardJournalLineResponse[];
};

export type AccountingDashboardResponse = {
  totalCash: number;
  totalReceivable: number;
  totalPayable: number;
  todayProfit: number;
  todayRevenue: number;
  todayExpense: number;
  monthProfit: number;
  monthRevenue: number;
  monthExpense: number;
  revenueTrend: { date: string; revenue: number }[];
  topExpenses: { accountCode: string; accountName: string; amount: number }[];
  recentJournals: DashboardJournalResponse[];
};

export type TaxSummaryDetailResponse = {
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  tax_type: string;
  tax_amount: number;
  dpp: number;
  reference_type: string;
};

export type TaxSummaryResponse = {
  period: { dateFrom: string; dateTo: string };
  ppnKeluaran: number;
  ppnMasukan: number;
  ppnKurangBayar: number;
  pph21: number;
  pph23: number;
  details: TaxSummaryDetailResponse[];
  total: number;
  totalPages: number;
};

export type EFakturExportResponse = {
  csv: string;
  filename: string;
};

export type AccountingAgingDetailResponse = {
  id: string;
  party_name: string;
  party_type: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  due_date: string | null;
  created_at: string;
  aging_bucket: string;
  days_past_due: number;
  reference_type: string;
  description: string;
};

export type AccountingAgingBucketsResponse = {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  noDueDate: number;
};

export type AccountingAgingByPartyResponse =
  AccountingAgingBucketsResponse & {
    partyName: string;
    total: number;
  };

export type AccountingAgingReportResponse = {
  type: "PAYABLE" | "RECEIVABLE";
  asOfDate: string;
  summary: AccountingAgingBucketsResponse & { total: number };
  details: AccountingAgingDetailResponse[];
  byParty: AccountingAgingByPartyResponse[];
};

export type DrillDownEntryResponse = {
  journal_id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  reference_type: string;
  debit: number;
  credit: number;
};

export type DrillDownResponse = {
  entries: DrillDownEntryResponse[];
  total: number;
  totalPages: number;
};

export type ClosingChecklistCheckResponse = {
  key: string;
  label: string;
  passed: boolean;
  count?: number;
  difference?: number;
  missing?: number;
};

export type ClosingChecklistResponse =
  | { error: string }
  | {
      period: {
        id: string;
        name: string;
        dateFrom: string;
        dateTo: string;
        status: string;
      };
      checks: ClosingChecklistCheckResponse[];
      allPassed: boolean;
    };

export type CreateClosingEntriesResponse =
  | { error: string }
  | { success: true; entryNumber: string; netIncome: number };
