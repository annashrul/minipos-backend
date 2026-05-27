import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const PERIOD_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  closedAt: true,
  closedBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { journals: true } },
} satisfies Prisma.AccountingPeriodSelect;

export type RawPeriod = Prisma.AccountingPeriodGetPayload<{
  select: typeof PERIOD_SELECT;
}>;

@Injectable()
export class AccountingPeriodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.AccountingPeriodWhereInput,
    orderBy:
      | Prisma.AccountingPeriodOrderByWithRelationInput
      | Prisma.AccountingPeriodOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<RawPeriod[]> {
    return this.prisma.accountingPeriod.findMany({
      where,
      select: PERIOD_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.AccountingPeriodWhereInput): Promise<number> {
    return this.prisma.accountingPeriod.count({ where });
  }

  async findOne(
    where: Prisma.AccountingPeriodWhereInput,
  ): Promise<RawPeriod | null> {
    return this.prisma.accountingPeriod.findFirst({
      where,
      select: PERIOD_SELECT,
    });
  }

  async findOneOrdered(
    where: Prisma.AccountingPeriodWhereInput,
    orderBy: Prisma.AccountingPeriodOrderByWithRelationInput,
  ): Promise<RawPeriod | null> {
    return this.prisma.accountingPeriod.findFirst({
      where,
      select: PERIOD_SELECT,
      orderBy,
    });
  }

  async findOverlap(
    companyId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<{ id: string; name: string } | null> {
    const where: Prisma.AccountingPeriodWhereInput = {
      companyId,
      status: { in: ["OPEN", "CLOSED", "LOCKED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    };
    if (excludeId) where.id = { not: excludeId };
    return this.prisma.accountingPeriod.findFirst({
      where,
      select: { id: true, name: true },
    });
  }

  async findStatus(
    companyId: string,
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
  }

  async findStatusWithDates(
    companyId: string,
    id: string,
  ): Promise<{
    id: string;
    status: string;
    startDate: Date;
    endDate: Date;
  } | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, startDate: true, endDate: true },
    });
  }

  async findLaterClosed(
    companyId: string,
    id: string,
    afterDate: Date,
  ): Promise<{ id: string; name: string } | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        id: { not: id },
        status: "CLOSED",
        startDate: { gt: afterDate },
      },
      select: { id: true, name: true },
    });
  }

  async create(
    data: Prisma.AccountingPeriodUncheckedCreateInput,
  ): Promise<RawPeriod> {
    return this.prisma.accountingPeriod.create({
      data,
      select: PERIOD_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.AccountingPeriodUpdateInput,
  ): Promise<RawPeriod> {
    return this.prisma.accountingPeriod.update({
      where: { id },
      data,
      select: PERIOD_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.accountingPeriod.delete({ where: { id } });
  }

  async countJournals(periodId: string): Promise<number> {
    return this.prisma.journalEntry.count({
      where: { periodId },
    });
  }
}
