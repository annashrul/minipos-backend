import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AccountingAgingByPartyResponse,
  AccountingAgingDetailResponse,
  AccountingAgingQueryDto,
  AccountingAgingReportResponse,
  ClosingChecklistResponse,
  CreateClosingEntriesResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { branchSQL, endOfDay } from "./accounting-reports.helpers";

@Injectable()
export class PeriodClosingService {
  constructor(private readonly prisma: PrismaService) {}

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

