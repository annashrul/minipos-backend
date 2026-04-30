import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateJournalDto,
  JournalDetailResponse,
  JournalListResponse,
  ListJournalsQueryDto,
  UpdateJournalDto,
} from "@/contracts";
import { PrismaService } from "../../../prisma/prisma.service";
import { JournalsContext } from "./journals-context.service";
import {
  assertBalanced,
  computeTotals,
  JOURNAL_DETAIL_SELECT,
  JOURNAL_SELECT,
  runWithEntryNumber,
  tenantWhere,
  toJournalDetailResponse,
  toJournalResponse,
} from "./journals.shared";

@Injectable()
export class JournalsCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: JournalsContext,
  ) {}

  async list(
    companyId: string,
    query: ListJournalsQueryDto,
  ): Promise<JournalListResponse> {
    const where = this.buildListWhere(companyId, query);

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

    return {
      journals: rows.map(toJournalResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const journal = await this.prisma.journalEntry.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: JOURNAL_DETAIL_SELECT,
    });
    if (!journal) throw new NotFoundException("Journal entry not found");
    return toJournalDetailResponse(journal);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateJournalDto,
  ): Promise<JournalDetailResponse> {
    if (dto.branchId) await this.context.assertBranch(companyId, dto.branchId);
    await this.context.assertAccountsValid(companyId, dto.lines);
    const { totalDebit, totalCredit } = computeTotals(dto.lines);
    assertBalanced(totalDebit, totalCredit);

    const date = new Date(dto.date);
    const periodId = await this.context.resolvePeriod(companyId, date);

    const created = await runWithEntryNumber(date, async (entryNumber) => {
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
      where: { id, ...tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Journal entry not found");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa diubah",
      );
    }

    if (dto.branchId) await this.context.assertBranch(companyId, dto.branchId);

    let totalDebit: number | undefined;
    let totalCredit: number | undefined;
    if (dto.lines) {
      await this.context.assertAccountsValid(companyId, dto.lines);
      const totals = computeTotals(dto.lines);
      totalDebit = totals.totalDebit;
      totalCredit = totals.totalCredit;
      assertBalanced(totalDebit, totalCredit);
    }

    let periodId: string | null | undefined;
    if (dto.date) {
      periodId = await this.context.resolvePeriod(
        companyId,
        new Date(dto.date),
      );
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

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Journal entry not found");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa dihapus",
      );
    }
    await this.prisma.journalEntry.delete({ where: { id } });
    return { success: true };
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

  private buildListWhere(
    companyId: string,
    query: ListJournalsQueryDto,
  ): Prisma.JournalEntryWhereInput {
    const { search, status, branchId, referenceType, from, to } = query;
    const where: Prisma.JournalEntryWhereInput = tenantWhere(companyId);

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
}
