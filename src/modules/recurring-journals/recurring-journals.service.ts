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
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  CreateRecurringJournalDto,
  ListRecurringJournalsQueryDto,
  RecurringJournalDetailResponse,
  RecurringJournalLineInputDto,
  RecurringJournalLineResponse,
  RecurringJournalResponse,
  RunRecurringJournalDto,
  RunRecurringJournalResponse,
  ToggleRecurringJournalDto,
  UpdateRecurringJournalDto,
} from "./dto/recurring-journals.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  RecurringJournalsRepository,
  type RawTemplate,
  type RawTemplateDetail,
} from "./recurring-journals.repository";

const BALANCE_TOLERANCE = 0.01;

@Injectable()
export class RecurringJournalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RecurringJournalsRepository,
    private readonly assert: AssertService,
  ) {}

  async list(
    companyId: string,
    query: ListRecurringJournalsQueryDto,
  ): Promise<PaginatedResponse<RecurringJournalResponse>> {
    const where: Prisma.RecurringJournalTemplateWhereInput = { companyId };
    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }
    if (query.branchId !== undefined) where.branchId = query.branchId;
    if (query.frequency) where.frequency = query.frequency;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [rows, total] = await Promise.all([
      this.repo.findMany(
        where,
        [{ nextRunDate: "asc" }, { createdAt: "desc" }],
        (query.page - 1) * query.perPage,
        query.perPage,
      ),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toTemplateResponse), total, query.page, query.perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<RecurringJournalDetailResponse> {
    const template = await this.repo.findOne({ id, companyId });
    if (!template) throw new NotFoundException("Jurnal berulang tidak ditemukan");
    return toTemplateDetailResponse(template);
  }

  async listDue(companyId: string): Promise<PaginatedResponse<RecurringJournalResponse>> {
    const now = new Date();
    const where: Prisma.RecurringJournalTemplateWhereInput = {
      companyId,
      isActive: true,
      nextRunDate: { lte: now },
    };
    const rows = await this.repo.findDue(where);
    return paginate(rows.map(toTemplateResponse), rows.length, 1, rows.length || 1);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateRecurringJournalDto,
  ): Promise<RecurringJournalDetailResponse> {
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);
    await this.assertAccountsValid(companyId, dto.lines);
    this.assertBalanced(dto.lines);

    const created = await this.repo.create({
      name: dto.name,
      description: dto.description ?? null,
      branchId: dto.branchId ?? null,
      frequency: dto.frequency,
      dayOfMonth: dto.dayOfMonth ?? null,
      nextRunDate: new Date(dto.nextRunDate),
      isActive: dto.isActive ?? true,
      companyId,
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
    });

    return toTemplateDetailResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateRecurringJournalDto,
  ): Promise<RecurringJournalDetailResponse> {
    const existing = await this.repo.findExistence({ id, companyId });
    if (!existing) throw new NotFoundException("Jurnal berulang tidak ditemukan");

    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);
    if (dto.lines) {
      await this.assertAccountsValid(companyId, dto.lines);
      this.assertBalanced(dto.lines);
    }

    const data: Prisma.RecurringJournalTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.dayOfMonth !== undefined) data.dayOfMonth = dto.dayOfMonth;
    if (dto.nextRunDate !== undefined) {
      data.nextRunDate = new Date(dto.nextRunDate);
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recurringJournalTemplate.update({ where: { id }, data });
      if (dto.lines) {
        await tx.recurringJournalLine.deleteMany({
          where: { templateId: id },
        });
        await tx.recurringJournalLine.createMany({
          data: dto.lines.map((line, idx) => ({
            templateId: id,
            accountId: line.accountId,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
            description: line.description ?? null,
            sortOrder: line.sortOrder ?? idx,
          })),
        });
      }
    });

    return this.findById(companyId, id);
  }

  async run(
    companyId: string,
    userId: string,
    id: string,
    dto: RunRecurringJournalDto,
  ): Promise<RunRecurringJournalResponse> {
    const template = await this.repo.findForRun({ id, companyId });
    if (!template) throw new NotFoundException("Jurnal berulang tidak ditemukan");
    if (!template.isActive) {
      throw new BadRequestException("Template tidak aktif");
    }
    if (template.lines.length < 2) {
      throw new BadRequestException("Template harus memiliki minimal 2 baris");
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of template.lines) {
      totalDebit += l.debit ?? 0;
      totalCredit += l.credit ?? 0;
    }
    totalDebit = round2(totalDebit);
    totalCredit = round2(totalCredit);
    if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
      throw new BadRequestException(
        `Jurnal tidak balance. Debit ${totalDebit}, Credit ${totalCredit}`,
      );
    }

    const runDate = new Date(template.nextRunDate);
    const nextRunDate = advanceDate(
      runDate,
      template.frequency,
      template.dayOfMonth,
    );
    const periodId = await this.resolvePeriod(companyId, runDate);
    const shouldPost = dto.post === true;

    const result = await this.runWithEntryNumber(runDate, async (entryNumber) =>
      this.prisma.$transaction(async (tx) => {
        const journal = await tx.journalEntry.create({
          data: {
            entryNumber,
            date: runDate,
            description: template.name,
            referenceType: "RECURRING",
            referenceId: template.id,
            branchId: template.branchId ?? null,
            periodId,
            status: shouldPost ? "POSTED" : "DRAFT",
            totalDebit,
            totalCredit,
            createdBy: userId,
            approvedBy: shouldPost ? userId : null,
            approvedAt: shouldPost ? new Date() : null,
            lines: {
              createMany: {
                data: template.lines.map((line, idx) => ({
                  accountId: line.accountId,
                  debit: line.debit ?? 0,
                  credit: line.credit ?? 0,
                  description: line.description ?? null,
                  sortOrder: line.sortOrder ?? idx,
                })),
              },
            },
          },
          select: { id: true, entryNumber: true },
        });

        await tx.recurringJournalTemplate.update({
          where: { id: template.id },
          data: {
            lastRunDate: new Date(),
            nextRunDate,
          },
        });

        return { journalId: journal.id, entryNumber: journal.entryNumber };
      }),
    );

    const updatedTemplate = await this.findById(companyId, id);
    return {
      template: stripLines(updatedTemplate),
      journalId: result.journalId,
      entryNumber: result.entryNumber,
    };
  }

  async toggle(
    companyId: string,
    id: string,
    dto: ToggleRecurringJournalDto,
  ): Promise<RecurringJournalDetailResponse> {
    const existing = await this.repo.findExistence({ id, companyId });
    if (!existing) throw new NotFoundException("Jurnal berulang tidak ditemukan");
    await this.repo.update(id, { isActive: dto.isActive });
    return this.findById(companyId, id);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findExistence({ id, companyId });
    if (!existing) throw new NotFoundException("Jurnal berulang tidak ditemukan");
    await this.repo.delete(id);
    return { success: true };
  }

  // ===== helpers =====

  private async assertAccountsValid(
    companyId: string,
    lines: RecurringJournalLineInputDto[],
  ) {
    const ids = Array.from(new Set(lines.map((l) => l.accountId)));
    if (ids.length === 0) {
      throw new BadRequestException("Daftar akun tidak boleh kosong");
    }
    const accounts = await this.repo.findActiveAccounts(companyId, ids);
    if (accounts.length !== ids.length) {
      throw new BadRequestException(
        "Salah satu akun tidak valid atau tidak aktif",
      );
    }
  }

  private assertBalanced(lines: RecurringJournalLineInputDto[]) {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      totalDebit += l.debit ?? 0;
      totalCredit += l.credit ?? 0;
    }
    totalDebit = round2(totalDebit);
    totalCredit = round2(totalCredit);
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
    const period = await this.repo.findOpenPeriod(companyId, date);
    if (!period) return null;
    if (period.status !== "OPEN") {
      throw new BadRequestException(
        "Periode akuntansi sudah ditutup, jurnal tidak bisa dibuat",
      );
    }
    return period.id;
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
}

function generateEntryNumber(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `JE-${yyyy}${mm}${dd}-${hex}`;
}

function advanceDate(
  current: Date,
  frequency: string,
  dayOfMonth: number | null,
): Date {
  const next = new Date(current);
  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case "MONTHLY":
      return advanceMonths(next, 1, dayOfMonth);
    case "QUARTERLY":
      return advanceMonths(next, 3, dayOfMonth);
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      if (dayOfMonth) {
        clampDayOfMonth(next, dayOfMonth);
      }
      return next;
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
  }
}

function advanceMonths(
  date: Date,
  months: number,
  dayOfMonth: number | null,
): Date {
  const next = new Date(date);
  const targetMonth = next.getUTCMonth() + months;
  next.setUTCDate(1);
  next.setUTCMonth(targetMonth);
  const day = dayOfMonth ?? date.getUTCDate();
  clampDayOfMonth(next, day);
  return next;
}

function clampDayOfMonth(date: Date, day: number): void {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
}

function toTemplateResponse(t: RawTemplate): RecurringJournalResponse {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    branchId: t.branchId,
    branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
    frequency: t.frequency,
    dayOfMonth: t.dayOfMonth,
    nextRunDate: t.nextRunDate.toISOString(),
    lastRunDate: t.lastRunDate ? t.lastRunDate.toISOString() : null,
    isActive: t.isActive,
    companyId: t.companyId,
    createdBy: t.createdBy,
    lineCount: t._count.lines,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toTemplateDetailResponse(
  t: RawTemplateDetail,
): RecurringJournalDetailResponse {
  return {
    ...toTemplateResponse(t),
    lines: t.lines.map<RecurringJournalLineResponse>((l) => ({
      id: l.id,
      templateId: l.templateId,
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

function stripLines(
  detail: RecurringJournalDetailResponse,
): RecurringJournalResponse {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lines: _lines, ...rest } = detail;
  return rest;
}
