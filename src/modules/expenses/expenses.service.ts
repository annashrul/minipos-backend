import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateExpenseDto,
  ExpenseResponse,
  ExpenseSummaryResponse,
  ListExpensesQueryDto,
  UpdateExpenseDto,
} from "./dto/expenses.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { tenantWhere } from "@/common/utils/tenant";
import { ExpensesRepository, type RawExpense } from "./expenses.repository";

@Injectable()
export class ExpensesService {
  constructor(private readonly repo: ExpensesRepository) {}

  async list(
    companyId: string,
    query: ListExpensesQueryDto,
  ): Promise<PaginatedResponse<ExpenseResponse>> {
    const { search, category, branchId, from, to, page, perPage } = query;

    const where: Prisma.ExpenseWhereInput = tenantWhere(companyId, "direct", "branch");
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

    return paginate(rows.map(toExpenseResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<ExpenseResponse> {
    const expense = await this.repo.findOne({
      id,
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!expense) throw new NotFoundException("Pengeluaran tidak ditemukan");
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
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!existing) throw new NotFoundException("Pengeluaran tidak ditemukan");

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
      ...tenantWhere(companyId, "direct", "branch"),
    });
    if (!existing) throw new NotFoundException("Pengeluaran tidak ditemukan");
    await this.repo.delete(id);
    return { success: true };
  }

  async summary(
    companyId: string,
    query: ListExpensesQueryDto,
  ): Promise<ExpenseSummaryResponse> {
    const { category, branchId, from, to } = query;
    const where: Prisma.ExpenseWhereInput = tenantWhere(companyId, "direct", "branch");
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

  async stats(companyId: string, branchId?: string) {
    const base: Prisma.ExpenseWhereInput = tenantWhere(companyId, "direct", "branch");
    if (branchId) base.branchId = branchId;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [total, thisMonth, today] = await Promise.all([
      this.repo.aggregate(base),
      this.repo.aggregate({ ...base, date: { gte: startOfMonth } }),
      this.repo.aggregate({ ...base, date: { gte: startOfDay } }),
    ]);

    return {
      totalCount: total._count._all,
      totalAmount: total._sum.amount ?? 0,
      thisMonthCount: thisMonth._count._all,
      thisMonthAmount: thisMonth._sum.amount ?? 0,
      todayCount: today._count._all,
      todayAmount: today._sum.amount ?? 0,
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.repo.findBranch(companyId, branchId);
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
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
