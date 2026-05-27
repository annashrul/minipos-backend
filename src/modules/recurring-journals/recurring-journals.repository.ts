import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  frequency: true,
  dayOfMonth: true,
  nextRunDate: true,
  lastRunDate: true,
  isActive: true,
  companyId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { lines: true } },
} satisfies Prisma.RecurringJournalTemplateSelect;

export const TEMPLATE_DETAIL_SELECT = {
  ...TEMPLATE_SELECT,
  lines: {
    select: {
      id: true,
      templateId: true,
      accountId: true,
      account: { select: { id: true, code: true, name: true } },
      description: true,
      debit: true,
      credit: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.RecurringJournalTemplateSelect;

const RUN_TEMPLATE_SELECT = {
  id: true,
  isActive: true,
  frequency: true,
  dayOfMonth: true,
  nextRunDate: true,
  branchId: true,
  name: true,
  lines: {
    select: {
      accountId: true,
      debit: true,
      credit: true,
      description: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.RecurringJournalTemplateSelect;

export type RawTemplate = Prisma.RecurringJournalTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;
export type RawTemplateDetail = Prisma.RecurringJournalTemplateGetPayload<{
  select: typeof TEMPLATE_DETAIL_SELECT;
}>;
export type RawRunTemplate = Prisma.RecurringJournalTemplateGetPayload<{
  select: typeof RUN_TEMPLATE_SELECT;
}>;

@Injectable()
export class RecurringJournalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.RecurringJournalTemplateWhereInput,
    orderBy:
      | Prisma.RecurringJournalTemplateOrderByWithRelationInput
      | Prisma.RecurringJournalTemplateOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<RawTemplate[]> {
    return this.prisma.recurringJournalTemplate.findMany({
      where,
      select: TEMPLATE_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(
    where: Prisma.RecurringJournalTemplateWhereInput,
  ): Promise<number> {
    return this.prisma.recurringJournalTemplate.count({ where });
  }

  async findOne(
    where: Prisma.RecurringJournalTemplateWhereInput,
  ): Promise<RawTemplateDetail | null> {
    return this.prisma.recurringJournalTemplate.findFirst({
      where,
      select: TEMPLATE_DETAIL_SELECT,
    });
  }

  async findDue(
    where: Prisma.RecurringJournalTemplateWhereInput,
  ): Promise<RawTemplate[]> {
    return this.prisma.recurringJournalTemplate.findMany({
      where,
      select: TEMPLATE_SELECT,
      orderBy: { nextRunDate: "asc" },
    });
  }

  async findExistence(
    where: Prisma.RecurringJournalTemplateWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.recurringJournalTemplate.findFirst({
      where,
      select: { id: true },
    });
  }

  async findForRun(
    where: Prisma.RecurringJournalTemplateWhereInput,
  ): Promise<RawRunTemplate | null> {
    return this.prisma.recurringJournalTemplate.findFirst({
      where,
      select: RUN_TEMPLATE_SELECT,
    });
  }

  async create(
    data: Prisma.RecurringJournalTemplateUncheckedCreateInput,
  ): Promise<RawTemplateDetail> {
    return this.prisma.recurringJournalTemplate.create({
      data,
      select: TEMPLATE_DETAIL_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.RecurringJournalTemplateUpdateInput,
  ): Promise<RawTemplate> {
    return this.prisma.recurringJournalTemplate.update({
      where: { id },
      data,
      select: TEMPLATE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.recurringJournalTemplate.delete({ where: { id } });
  }

  async findActiveAccounts(
    companyId: string,
    ids: string[],
  ): Promise<{ id: string }[]> {
    return this.prisma.account.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        category: { companyId },
      },
      select: { id: true },
    });
  }

  async findOpenPeriod(
    companyId: string,
    date: Date,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { id: true, status: true },
    });
  }
}
