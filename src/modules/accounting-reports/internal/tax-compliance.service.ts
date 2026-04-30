import { Injectable } from "@nestjs/common";
import type {
  EFakturExportQueryDto,
  EFakturExportResponse,
  TaxSummaryDetailResponse,
  TaxSummaryQueryDto,
  TaxSummaryResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { branchSQL, endOfDay, toDate } from "./accounting-reports.helpers";

@Injectable()
export class TaxComplianceService {
  constructor(private readonly prisma: PrismaService) {}

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
    const branchFilter =
      branchId && branchId !== "ALL" ? `AND je."branchId" = '${branchId}'` : "";
    const typeFilter =
      taxType && taxType !== "ALL" ? `AND jel."taxType" = '${taxType}'` : "";
    const searchFilter = search
      ? `AND (je."entryNumber" ILIKE '%${search}%' OR je.description ILIKE '%${search}%' OR je.reference ILIKE '%${search}%')`
      : "";

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

    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        tax_type: string;
        total_tax: number;
        total_dpp: number;
        count: number;
      }>
    >(`
      SELECT
        jel."taxType" AS tax_type,
        COALESCE(SUM(COALESCE(jel."taxAmount", 0)), 0)::float AS total_tax,
        COALESCE(SUM(COALESCE(jel."taxBaseAmount", 0)), 0)::float AS total_dpp,
        COUNT(*)::int AS count
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
      GROUP BY jel."taxType"
    `);

    const map = new Map(results.map((r) => [r.tax_type, r]));
    const ppnKeluaran = map.get("PPN_KELUARAN")?.total_tax ?? 0;
    const ppnMasukan = map.get("PPN_MASUKAN")?.total_tax ?? 0;
    const ppnKurangBayar = ppnKeluaran - ppnMasukan;

    const details = await this.prisma.$queryRawUnsafe<
      TaxSummaryDetailResponse[]
    >(`
      SELECT
        je."entryNumber" AS entry_number, je.date::text, je.description,
        COALESCE(je.reference, '') AS reference,
        jel."taxType" AS tax_type,
        COALESCE(jel."taxAmount", 0)::float AS tax_amount,
        COALESCE(jel."taxBaseAmount", 0)::float AS dpp,
        COALESCE(je."referenceType", 'MANUAL') AS reference_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
        ${typeFilter}
        ${searchFilter}
      ORDER BY ${sortColumn} ${sortDirSql}
      LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `);

    const countResult = await this.prisma.$queryRawUnsafe<[{ total: number }]>(`
      SELECT COUNT(*)::int AS total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IS NOT NULL
        AND je.date >= '${dateFrom}'
        AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
        ${branchFilter}
        ${typeFilter}
        ${searchFilter}
    `);
    const total = Number(countResult[0]?.total ?? 0);

    return {
      period: { dateFrom, dateTo },
      ppnKeluaran,
      ppnMasukan,
      ppnKurangBayar,
      pph21: map.get("PPH21")?.total_tax ?? 0,
      pph23: map.get("PPH23")?.total_tax ?? 0,
      details,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getEFakturExport(
    companyId: string,
    params: EFakturExportQueryDto,
  ): Promise<EFakturExportResponse> {
    const { dateFrom, dateTo } = params;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        date: string;
        invoice: string;
        dpp: number;
        ppn: number;
        supplier_or_customer: string;
        reference_type: string;
      }>
    >(`
      SELECT
        je.date::text, COALESCE(je.reference, je."entryNumber") AS invoice,
        COALESCE(jel."taxBaseAmount", 0)::float AS dpp,
        COALESCE(jel."taxAmount", 0)::float AS ppn,
        COALESCE(je.description, '') AS supplier_or_customer,
        COALESCE(je."referenceType", 'MANUAL') AS reference_type
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel."journalId"
      JOIN accounts a ON a.id = jel."accountId"
      JOIN account_categories ac ON ac.id = a."categoryId"
      WHERE je.status = 'POSTED'
        AND jel."taxType" IN ('PPN_KELUARAN', 'PPN_MASUKAN')
        AND je.date >= '${dateFrom}' AND je.date <= '${dateTo}'
        AND ac."companyId" = '${companyId}'
      ORDER BY je.date ASC
    `);

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
}
