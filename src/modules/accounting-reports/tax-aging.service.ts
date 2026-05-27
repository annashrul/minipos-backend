import { Injectable } from "@nestjs/common";
import { toDateOnly } from "@/common/utils/date";
import { paginate } from "@/common/utils/pagination";
import type {
  AccountingAgingByPartyResponse,
  AccountingAgingQueryDto,
  AccountingAgingReportResponse,
  ClosingChecklistResponse,
  CreateClosingEntriesResponse,
  EFakturExportQueryDto,
  EFakturExportResponse,
  TaxSummaryQueryDto,
  TaxSummaryResponse,
  TaxSummaryDetailResponse,
} from "./dto/accounting-reports.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { AccountingReportsRepository } from "./accounting-reports.repository";

@Injectable()
export class TaxAgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountingReportsRepository,
  ) {}

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
      ...paginate(details as unknown as TaxSummaryDetailResponse[], total, page, perPage),
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
      details: rows as unknown as import("./dto/accounting-reports.dto").AccountingAgingDetailResponse[],
      byParty: Array.from(byPartyMap.values()).sort(
        (a, b) => b.total - a.total,
      ),
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
