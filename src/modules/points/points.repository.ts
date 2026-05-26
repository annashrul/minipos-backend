import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const HISTORY_SELECT = {
  id: true,
  customerId: true,
  points: true,
  type: true,
  reference: true,
  description: true,
  createdAt: true,
} satisfies Prisma.CustomerPointHistorySelect;

export type RawHistory = Prisma.CustomerPointHistoryGetPayload<{
  select: typeof HISTORY_SELECT;
}>;

@Injectable()
export class PointsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCustomer(
    companyId: string,
    customerId: string,
  ): Promise<{ id: string; points: number } | null> {
    return this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, points: true },
    });
  }

  async aggregatePoints(
    customerId: string,
    type: Prisma.CustomerPointHistoryWhereInput["type"],
  ): Promise<number> {
    const result = await this.prisma.customerPointHistory.aggregate({
      where: { customerId, type },
      _sum: { points: true },
    });
    return result._sum.points ?? 0;
  }

  async findManyHistory(
    where: Prisma.CustomerPointHistoryWhereInput,
    skip: number,
    take: number,
  ): Promise<RawHistory[]> {
    return this.prisma.customerPointHistory.findMany({
      where,
      select: HISTORY_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countHistory(
    where: Prisma.CustomerPointHistoryWhereInput,
  ): Promise<number> {
    return this.prisma.customerPointHistory.count({ where });
  }
}
