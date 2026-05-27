import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const EXPENSE_SELECT = {
  id: true,
  category: true,
  description: true,
  amount: true,
  date: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExpenseSelect;

export type RawExpense = Prisma.ExpenseGetPayload<{
  select: typeof EXPENSE_SELECT;
}>;

@Injectable()
export class ExpensesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.ExpenseWhereInput,
    skip: number,
    take: number,
  ): Promise<RawExpense[]> {
    return this.prisma.expense.findMany({
      where,
      select: EXPENSE_SELECT,
      orderBy: { date: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.ExpenseWhereInput): Promise<number> {
    return this.prisma.expense.count({ where });
  }

  async findOne(where: Prisma.ExpenseWhereInput): Promise<RawExpense | null> {
    return this.prisma.expense.findFirst({
      where,
      select: EXPENSE_SELECT,
    });
  }

  async findById(
    where: Prisma.ExpenseWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.expense.findFirst({
      where,
      select: { id: true },
    });
  }

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async create(data: Prisma.ExpenseUncheckedCreateInput): Promise<RawExpense> {
    return this.prisma.expense.create({
      data,
      select: EXPENSE_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.ExpenseUpdateInput,
  ): Promise<RawExpense> {
    return this.prisma.expense.update({
      where: { id },
      data,
      select: EXPENSE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.expense.delete({ where: { id } });
  }

  async aggregate(where: Prisma.ExpenseWhereInput) {
    return this.prisma.expense.aggregate({
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
  }

  async groupByCategory(where: Prisma.ExpenseWhereInput) {
    return this.prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
  }
}
