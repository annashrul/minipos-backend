import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  DrillDownQueryDto,
  DrillDownResponse,
  GeneralLedgerQueryDto,
  GeneralLedgerResponse,
  LedgerEntryResponse,
  TrialBalanceQueryDto,
  TrialBalanceResponse,
  TrialBalanceRowResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { branchSQL, dateToIso, endOfDay, toDate } from "./accounting-reports.helpers";

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

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
}
