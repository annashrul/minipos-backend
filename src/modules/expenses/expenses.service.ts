import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateExpenseDto,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseSummaryResponse,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from "./dto/expenses.dto";
import { ExpensesRepository, type RawExpense } from "./expenses.repository";

@Injectable()
export class ExpensesService {
  constructor(private readonly repo: ExpensesRepository) {}

  async list(
    companyId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseListResponse> {
    const { search, category, branchId, from, to, page, perPage } = query;

    const where = this.tenantWhere(companyId);
    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { category: { contains: search, mode: "insensitive" } },
      ];
    }
    if (category) where.category = category;
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return {
      expenses: rows.map(toExpenseResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<ExpenseResponse> {
    const expense = await this.repo.findOne({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!expense) throw new NotFoundException("Expense not found");
    return toExpenseResponse(expense);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const created = await this.repo.create({
      category: dto.category,
      description: dto.description,
      amount: dto.amount,
      date: dto.date ? new Date(dto.date) : new Date(),
      branchId: dto.branchId ?? null,
      companyId,
      createdBy: userId,
    });
    return toExpenseResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponse> {
    const existing = await this.repo.findById({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Expense not found");

    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    const updated = await this.repo.update(id, data);
    return toExpenseResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Expense not found");
    await this.repo.delete(id);
    return { success: true };
  }

  async summary(
    companyId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseSummaryResponse> {
    const { category, branchId, from, to } = query;
    const where = this.tenantWhere(companyId);
    if (category) where.category = category;
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [agg, grouped] = await Promise.all([
      this.repo.aggregate(where),
      this.repo.groupByCategory(where),
    ]);

    return {
      total: agg._sum.amount ?? 0,
      count: agg._count._all,
      byCategory: grouped
        .map((g) => ({
          category: g.category,
          total: g._sum.amount ?? 0,
          count: g._count._all,
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  private tenantWhere(companyId: string): Prisma.ExpenseWhereInput {
    return {
      OR: [{ companyId }, { branch: { companyId } }],
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.repo.findBranch(companyId, branchId);
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function toExpenseResponse(e: RawExpense): ExpenseResponse {
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    amount: e.amount,
    date: e.date.toISOString(),
    branchId: e.branchId,
    branch: e.branch ? { id: e.branch.id, name: e.branch.name } : null,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
