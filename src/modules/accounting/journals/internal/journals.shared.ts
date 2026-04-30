import {
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type {
  JournalDetailResponse,
  JournalLineInputDto,
  JournalLineResponse,
  JournalResponse,
} from "@/contracts";

export const JOURNAL_SELECT = {
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

export const JOURNAL_DETAIL_SELECT = {
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

export type RawJournal = Prisma.JournalEntryGetPayload<{
  select: typeof JOURNAL_SELECT;
}>;
export type RawJournalDetail = Prisma.JournalEntryGetPayload<{
  select: typeof JOURNAL_DETAIL_SELECT;
}>;

export const BALANCE_TOLERANCE = 0.01;
const MAX_ENTRY_NUMBER_RETRIES = 3;

export function tenantWhere(
  companyId: string,
): Prisma.JournalEntryWhereInput {
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

export function generateEntryNumber(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `JE-${yyyy}${mm}${dd}-${hex}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTotals(lines: JournalLineInputDto[]): {
  totalDebit: number;
  totalCredit: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    totalDebit += line.debit ?? 0;
    totalCredit += line.credit ?? 0;
  }
  return { totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) };
}

export function assertBalanced(
  totalDebit: number,
  totalCredit: number,
): void {
  if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
    throw new BadRequestException(
      `Jurnal tidak balance. Debit ${totalDebit}, Credit ${totalCredit}`,
    );
  }
}

export async function runWithEntryNumber<T>(
  date: Date,
  fn: (entryNumber: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ENTRY_NUMBER_RETRIES; attempt++) {
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

export function toJournalResponse(j: RawJournal): JournalResponse {
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

export function toJournalDetailResponse(
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
