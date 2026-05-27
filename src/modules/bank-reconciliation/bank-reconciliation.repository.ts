import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const RECON_SELECT = {
  id: true,
  accountId: true,
  account: { select: { id: true, code: true, name: true } },
  statementDate: true,
  statementBalance: true,
  bookBalance: true,
  status: true,
  companyId: true,
  completedBy: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.BankReconciliationSelect;

export const RECON_DETAIL_SELECT = {
  ...RECON_SELECT,
  items: {
    select: {
      id: true,
      reconciliationId: true,
      source: true,
      referenceNumber: true,
      description: true,
      date: true,
      amount: true,
      matchedItemId: true,
      matchStatus: true,
      journalEntryId: true,
      createdAt: true,
    },
    orderBy: { date: "asc" },
  },
} satisfies Prisma.BankReconciliationSelect;

export type RawRecon = Prisma.BankReconciliationGetPayload<{
  select: typeof RECON_SELECT;
}>;
export type RawReconDetail = Prisma.BankReconciliationGetPayload<{
  select: typeof RECON_DETAIL_SELECT;
}>;
export type RawReconItem = RawReconDetail["items"][number];

@Injectable()
export class BankReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.BankReconciliationWhereInput,
    skip: number,
    take: number,
  ): Promise<RawRecon[]> {
    return this.prisma.bankReconciliation.findMany({
      where,
      select: RECON_SELECT,
      orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    });
  }

  async count(where: Prisma.BankReconciliationWhereInput): Promise<number> {
    return this.prisma.bankReconciliation.count({ where });
  }

  async findOne(
    where: Prisma.BankReconciliationWhereInput,
  ): Promise<RawReconDetail | null> {
    return this.prisma.bankReconciliation.findFirst({
      where,
      select: RECON_DETAIL_SELECT,
    });
  }

  async findStatus(
    id: string,
    companyId: string,
  ): Promise<{ id: string; status: string; accountId: string } | null> {
    return this.prisma.bankReconciliation.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, accountId: true },
    });
  }

  async findStatusOnly(
    id: string,
    companyId: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.bankReconciliation.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
  }

  async findForReconcile(
    id: string,
    companyId: string,
  ): Promise<{
    id: string;
    status: string;
    statementBalance: number;
    bookBalance: number;
  } | null> {
    return this.prisma.bankReconciliation.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        status: true,
        statementBalance: true,
        bookBalance: true,
      },
    });
  }

  async create(
    data: Prisma.BankReconciliationUncheckedCreateInput,
  ): Promise<RawReconDetail> {
    return this.prisma.bankReconciliation.create({
      data,
      select: RECON_DETAIL_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.BankReconciliationUpdateInput,
  ): Promise<void> {
    await this.prisma.bankReconciliation.update({ where: { id }, data });
  }

  async countItems(reconciliationId: string): Promise<number> {
    return this.prisma.bankReconciliationItem.count({
      where: { reconciliationId },
    });
  }

  async countUnmatchedItems(reconciliationId: string): Promise<number> {
    return this.prisma.bankReconciliationItem.count({
      where: { reconciliationId, matchStatus: "UNMATCHED" },
    });
  }

  async findItem(
    itemId: string,
    reconciliationId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.bankReconciliationItem.findFirst({
      where: { id: itemId, reconciliationId },
      select: { id: true },
    });
  }

  async updateItem(
    itemId: string,
    data: Prisma.BankReconciliationItemUpdateInput,
  ): Promise<void> {
    await this.prisma.bankReconciliationItem.update({
      where: { id: itemId },
      data,
    });
  }

  async assertAccount(
    companyId: string,
    accountId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.account.findFirst({
      where: {
        id: accountId,
        isActive: true,
        category: { companyId },
      },
      select: { id: true },
    });
  }

  async findJournalEntries(
    journalIds: string[],
    accountId: string,
    companyId: string,
  ): Promise<{ id: string }[]> {
    return this.prisma.journalEntry.findMany({
      where: {
        id: { in: journalIds },
        lines: { some: { accountId } },
        OR: [
          { branch: { companyId } },
          { period: { companyId } },
          {
            AND: [{ branchId: null }, { periodId: null }],
            lines: { some: { account: { category: { companyId } } } },
          },
        ],
      },
      select: { id: true },
    });
  }

  async findAccountForBalance(
    accountId: string,
  ): Promise<{
    openingBalance: number | null;
    category: { normalSide: string } | null;
  } | null> {
    return this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        openingBalance: true,
        category: { select: { normalSide: true } },
      },
    });
  }

  async aggregateJournalLines(
    accountId: string,
    asOfDate: Date,
  ): Promise<{ debitSum: number; creditSum: number }> {
    const agg = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journal: { status: "POSTED", date: { lte: asOfDate } },
      },
      _sum: { debit: true, credit: true },
    });
    return {
      debitSum: agg._sum.debit ?? 0,
      creditSum: agg._sum.credit ?? 0,
    };
  }
}
