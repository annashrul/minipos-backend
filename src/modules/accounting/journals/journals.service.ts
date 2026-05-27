import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { round2 } from "@/common/utils/math";
import { AssertService } from "@/common/assert/assert.service";
import type {
  CreateJournalDto,
  JournalDetailResponse,
  JournalLineInputDto,
  JournalLineResponse,
  JournalListResponse,
  JournalResponse,
  ListJournalsQueryDto,
  UpdateJournalDto,
  VoidJournalDto,
} from "../dto/accounting.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { paginate } from "@/common/utils/pagination";

const JOURNAL_SELECT = {
  id: true,
  entryNumber: true,
  date: true,
  description: true,
  reference: true,
  referenceType: true,
  referenceId: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  periodId: true,
  status: true,
  totalDebit: true,
  totalCredit: true,
  notes: true,
  rejectionNote: true,
  createdBy: true,
  approvedBy: true,
  approvedAt: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { lines: true } },
} satisfies Prisma.JournalEntrySelect;

const JOURNAL_DETAIL_SELECT = {
  ...JOURNAL_SELECT,
  lines: {
    select: {
      id: true,
      journalId: true,
      accountId: true,
      account: { select: { id: true, code: true, name: true } },
      description: true,
      debit: true,
      credit: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.JournalEntrySelect;

type RawJournal = Prisma.JournalEntryGetPayload<{
  select: typeof JOURNAL_SELECT;
}>;
type RawJournalDetail = Prisma.JournalEntryGetPayload<{
  select: typeof JOURNAL_DETAIL_SELECT;
}>;

const BALANCE_TOLERANCE = 0.01;

@Injectable()
export class JournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assert: AssertService,
  ) {}

  async list(
    companyId: string,
    query: ListJournalsQueryDto,
  ): Promise<JournalListResponse> {
    const where = await this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        select: JOURNAL_SELECT,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return paginate(rows.map(toJournalResponse), total, query.page, query.perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const journal = await this.prisma.journalEntry.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: JOURNAL_DETAIL_SELECT,
    });
    if (!journal) throw new NotFoundException("Jurnal tidak ditemukan");
    return toJournalDetailResponse(journal);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateJournalDto,
  ): Promise<JournalDetailResponse> {
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);
    await this.assertAccountsValid(companyId, dto.lines);
    const { totalDebit, totalCredit } = this.computeTotals(dto.lines);
    this.assertBalanced(totalDebit, totalCredit);

    const date = new Date(dto.date);
    const periodId = await this.resolvePeriod(companyId, date);

    const created = await this.runWithEntryNumber(date, async (entryNumber) => {
      return this.prisma.$transaction(async (tx) => {
        const journal = await tx.journalEntry.create({
          data: {
            entryNumber,
            date,
            description: dto.description,
            reference: dto.reference ?? null,
            referenceType: dto.referenceType ?? null,
            referenceId: dto.referenceId ?? null,
            branchId: dto.branchId ?? null,
            periodId,
            status: "DRAFT",
            totalDebit,
            totalCredit,
            notes: dto.notes ?? null,
            createdBy: userId,
            lines: {
              createMany: {
                data: dto.lines.map((line, idx) => ({
                  accountId: line.accountId,
                  debit: line.debit ?? 0,
                  credit: line.credit ?? 0,
                  description: line.description ?? null,
                  sortOrder: line.sortOrder ?? idx,
                })),
              },
            },
          },
          select: { id: true },
        });

        return tx.journalEntry.findUniqueOrThrow({
          where: { id: journal.id },
          select: JOURNAL_DETAIL_SELECT,
        });
      });
    });

    return toJournalDetailResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateJournalDto,
  ): Promise<JournalDetailResponse> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Jurnal tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa diubah",
      );
    }

    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    let totalDebit: number | undefined;
    let totalCredit: number | undefined;
    if (dto.lines) {
      await this.assertAccountsValid(companyId, dto.lines);
      const totals = this.computeTotals(dto.lines);
      totalDebit = totals.totalDebit;
      totalCredit = totals.totalCredit;
      this.assertBalanced(totalDebit, totalCredit);
    }

    let periodId: string | null | undefined;
    if (dto.date) {
      periodId = await this.resolvePeriod(companyId, new Date(dto.date));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.JournalEntryUpdateInput = { updatedBy: userId };
      if (dto.date !== undefined) data.date = new Date(dto.date);
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.referenceType !== undefined) {
        data.referenceType = dto.referenceType;
      }
      if (dto.referenceId !== undefined) data.referenceId = dto.referenceId;
      if (dto.branchId !== undefined) {
        data.branch = dto.branchId
          ? { connect: { id: dto.branchId } }
          : { disconnect: true };
      }
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (periodId !== undefined) {
        data.period = periodId
          ? { connect: { id: periodId } }
          : { disconnect: true };
      }
      if (totalDebit !== undefined) data.totalDebit = totalDebit;
      if (totalCredit !== undefined) data.totalCredit = totalCredit;

      await tx.journalEntry.update({ where: { id }, data });

      if (dto.lines) {
        await tx.journalEntryLine.deleteMany({ where: { journalId: id } });
        await tx.journalEntryLine.createMany({
          data: dto.lines.map((line, idx) => ({
            journalId: id,
            accountId: line.accountId,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
            description: line.description ?? null,
            sortOrder: line.sortOrder ?? idx,
          })),
        });
      }

      return tx.journalEntry.findUniqueOrThrow({
        where: { id },
        select: JOURNAL_DETAIL_SELECT,
      });
    });

    return toJournalDetailResponse(updated);
  }

  async post(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        date: true,
        lines: { select: { debit: true, credit: true } },
      },
    });
    if (!existing) throw new NotFoundException("Jurnal tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa di-post",
      );
    }
    if (existing.lines.length < 2) {
      throw new BadRequestException("Jurnal minimal memiliki 2 baris");
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of existing.lines) {
      totalDebit += line.debit ?? 0;
      totalCredit += line.credit ?? 0;
    }
    this.assertBalanced(totalDebit, totalCredit);
    await this.assertPeriodOpen(companyId, existing.date);

    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "POSTED",
        approvedBy: userId,
        approvedAt: new Date(),
        totalDebit,
        totalCredit,
        updatedBy: userId,
      },
    });

    return this.findById(companyId, id);
  }

  async voidEntry(
    companyId: string,
    userId: string,
    id: string,
    dto: VoidJournalDto,
  ): Promise<JournalDetailResponse & { reversingEntryNumber?: string }> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        entryNumber: true,
        description: true,
        branchId: true,
        totalDebit: true,
        totalCredit: true,
        notes: true,
        lines: {
          select: {
            accountId: true,
            description: true,
            debit: true,
            credit: true,
            sortOrder: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Jurnal tidak ditemukan");
    if (existing.status === "VOIDED") {
      throw new BadRequestException("Jurnal sudah di-void");
    }
    if (existing.status === "DRAFT") {
      throw new BadRequestException(
        "Jurnal DRAFT tidak perlu void â€” hapus saja",
      );
    }

    const today = new Date();
    const currentPeriod = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: today },
        endDate: { gte: today },
        status: "OPEN",
      },
      select: { id: true },
    });

    const result = await this.runWithEntryNumber(
      today,
      async (reversingNumber) =>
        this.prisma.$transaction(async (tx) => {
          await tx.journalEntry.update({
            where: { id },
            data: {
              status: "VOIDED",
              rejectionNote: dto.voidReason,
              updatedBy: userId,
              notes: existing.notes
                ? `${existing.notes}\n[VOIDED] ${dto.voidReason}`
                : `[VOIDED] ${dto.voidReason}`,
            },
          });
          await tx.journalEntry.create({
            data: {
              entryNumber: reversingNumber,
              date: today,
              description: `Reversing: ${existing.description} â€” ${dto.voidReason}`,
              reference: existing.entryNumber,
              referenceType: "MANUAL",
              referenceId: existing.id,
              branchId: existing.branchId,
              periodId: currentPeriod?.id ?? null,
              status: "POSTED",
              totalDebit: existing.totalCredit,
              totalCredit: existing.totalDebit,
              createdBy: userId,
              notes: `Reversing entry for voided journal ${existing.entryNumber}`,
              lines: {
                createMany: {
                  data: existing.lines.map((line, idx) => ({
                    accountId: line.accountId,
                    description: `Reversing: ${line.description ?? ""}`,
                    debit: line.credit,
                    credit: line.debit,
                    sortOrder: idx,
                  })),
                },
              },
            },
          });
          return reversingNumber;
        }),
    );

    const detail = await this.findById(companyId, id);
    return { ...detail, reversingEntryNumber: result };
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Jurnal tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa dihapus",
      );
    }
    await this.prisma.journalEntry.delete({ where: { id } });
    return { success: true };
  }

  // ===== helpers =====

  private async buildListWhere(
    companyId: string,
    query: ListJournalsQueryDto,
  ): Promise<Prisma.JournalEntryWhereInput> {
    const { search, status, branchId, referenceType, from, to } = query;
    const where: Prisma.JournalEntryWhereInput = this.tenantWhere(companyId);

    if (status) where.status = status;
    if (branchId !== undefined) where.branchId = branchId;
    if (referenceType) where.referenceType = referenceType;
    if (search) {
      where.OR = [
        { entryNumber: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.JournalEntryWhereInput {
    return {
      OR: [
        { branch: { companyId } },
        { period: { companyId } },
        {
          AND: [{ branchId: null }, { periodId: null }],
          // fallback: lines tied to accounts in this company
          lines: { some: { account: { category: { companyId } } } },
        },
      ],
    };
  }

  private async assertAccountsValid(
    companyId: string,
    lines: JournalLineInputDto[],
  ) {
    const ids = Array.from(new Set(lines.map((l) => l.accountId)));
    if (ids.length === 0) {
      throw new BadRequestException("Daftar akun tidak boleh kosong");
    }
    const accounts = await this.prisma.account.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        category: { companyId },
      },
      select: { id: true },
    });
    if (accounts.length !== ids.length) {
      throw new BadRequestException(
        "Salah satu akun tidak valid atau tidak aktif",
      );
    }
  }

  private computeTotals(lines: JournalLineInputDto[]): {
    totalDebit: number;
    totalCredit: number;
  } {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += line.debit ?? 0;
      totalCredit += line.credit ?? 0;
    }
    return {
      totalDebit: round2(totalDebit),
      totalCredit: round2(totalCredit),
    };
  }

  private assertBalanced(totalDebit: number, totalCredit: number) {
    if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
      throw new BadRequestException(
        `Jurnal tidak balance. Debit ${totalDebit}, Credit ${totalCredit}`,
      );
    }
  }

  private async resolvePeriod(
    companyId: string,
    date: Date,
  ): Promise<string | null> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { id: true, status: true },
    });
    if (!period) return null;
    if (period.status !== "OPEN") {
      throw new BadRequestException(
        "Periode akuntansi sudah ditutup, jurnal tidak bisa dibuat/diubah",
      );
    }
    return period.id;
  }

  private async assertPeriodOpen(companyId: string, date: Date) {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { status: true },
    });
    if (period && period.status !== "OPEN") {
      throw new BadRequestException(
        "Periode akuntansi sudah ditutup, jurnal tidak bisa di-post",
      );
    }
  }

  private async runWithEntryNumber<T>(
    date: Date,
    fn: (entryNumber: string) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const entryNumber = generateEntryNumber(date);
      try {
        return await fn(entryNumber);
      } catch (err) {
        lastErr = err;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }
    if (
      lastErr instanceof Prisma.PrismaClientKnownRequestError &&
      lastErr.code === "P2002"
    ) {
      throw new ConflictException("Gagal generate nomor jurnal, coba lagi");
    }
    throw lastErr;
  }

  async submitForApproval(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: {
        id: true,
        status: true,
        totalDebit: true,
        totalCredit: true,
        entryNumber: true,
      },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal DRAFT yang dapat diajukan untuk approval",
      );
    }
    if (Math.abs(entry.totalDebit - entry.totalCredit) > 0.01) {
      throw new BadRequestException(
        "Total debit dan kredit tidak seimbang",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: { status: "PENDING_APPROVAL", updatedBy: userId },
    });
    return this.findById(companyId, id);
  }

  async approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Hanya jurnal PENDING_APPROVAL yang dapat disetujui",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
    return this.findById(companyId, id);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<JournalDetailResponse> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException("Alasan penolakan wajib diisi");
    }
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Hanya jurnal PENDING_APPROVAL yang dapat ditolak",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionNote: reason.trim(),
        updatedBy: userId,
      },
    });
    return this.findById(companyId, id);
  }

  async changeHistory(
    companyId: string,
    journalId: string,
  ): Promise<unknown[]> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: journalId, branch: { companyId } },
      select: { id: true },
    });
    if (!entry) return [];
    return this.prisma.journalChangeLog.findMany({
      where: { journalId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }
}

function generateEntryNumber(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `JE-${yyyy}${mm}${dd}-${hex}`;
}

function toJournalResponse(j: RawJournal): JournalResponse {
  return {
    id: j.id,
    entryNumber: j.entryNumber,
    date: j.date.toISOString(),
    description: j.description,
    reference: j.reference,
    referenceType: j.referenceType,
    referenceId: j.referenceId,
    branchId: j.branchId,
    branch: j.branch ? { id: j.branch.id, name: j.branch.name } : null,
    periodId: j.periodId,
    status: j.status,
    totalDebit: j.totalDebit,
    totalCredit: j.totalCredit,
    notes: j.notes,
    rejectionNote: j.rejectionNote,
    createdBy: j.createdBy,
    approvedBy: j.approvedBy,
    approvedAt: j.approvedAt ? j.approvedAt.toISOString() : null,
    updatedBy: j.updatedBy,
    lineCount: j._count.lines,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

function toJournalDetailResponse(
  j: RawJournalDetail,
): JournalDetailResponse {
  return {
    ...toJournalResponse(j),
    lines: j.lines.map<JournalLineResponse>((l) => ({
      id: l.id,
      journalId: l.journalId,
      accountId: l.accountId,
      account: l.account
        ? { id: l.account.id, code: l.account.code, name: l.account.name }
        : null,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      sortOrder: l.sortOrder,
    })),
  };
}
