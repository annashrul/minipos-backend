import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const BRANCH_SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  phone: true,
  latitude: true,
  longitude: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true, transactions: true } },
} satisfies Prisma.BranchSelect;

export type RawBranch = Prisma.BranchGetPayload<{
  select: typeof BRANCH_SELECT;
}>;

@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.BranchWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBranch[]> {
    return this.prisma.branch.findMany({
      where,
      select: BRANCH_SELECT,
      orderBy: { name: "asc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.BranchWhereInput): Promise<number> {
    return this.prisma.branch.count({ where });
  }

  async findOne(where: Prisma.BranchWhereInput): Promise<RawBranch | null> {
    return this.prisma.branch.findFirst({
      where,
      select: BRANCH_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
  }

  async findWithCounts(
    companyId: string,
    id: string,
  ): Promise<{
    id: string;
    _count: { users: number; transactions: number };
  } | null> {
    return this.prisma.branch.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        _count: { select: { users: true, transactions: true } },
      },
    });
  }

  async create(data: Prisma.BranchUncheckedCreateInput): Promise<RawBranch> {
    return this.prisma.branch.create({
      data,
      select: BRANCH_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.BranchUpdateInput,
  ): Promise<RawBranch> {
    return this.prisma.branch.update({
      where: { id },
      data,
      select: BRANCH_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.branch.delete({ where: { id } });
  }
}
