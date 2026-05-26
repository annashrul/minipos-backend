import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AccountListResponse,
  AccountResponse,
  AccountTreeNode,
  AccountTreeResponse,
  AccountWithBalanceResponse,
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from "../dto/accounting.dto";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate } from "../../../common/utils/pagination";

const ACCOUNT_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  categoryId: true,
  category: {
    select: { id: true, name: true, type: true, normalSide: true },
  },
  parentId: true,
  parent: { select: { id: true, name: true, code: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  isActive: true,
  isSystem: true,
  openingBalance: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { children: true } },
} satisfies Prisma.AccountSelect;

type RawAccount = Prisma.AccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListAccountsQueryDto,
  ): Promise<AccountListResponse> {
    const where = await this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        select: ACCOUNT_SELECT,
        orderBy: [{ code: "asc" }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.account.count({ where }),
    ]);

    return paginate(rows.map(toAccountResponse), total, query.page, query.perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<AccountWithBalanceResponse> {
    const account = await this.prisma.account.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: ACCOUNT_SELECT,
    });
    if (!account) throw new NotFoundException("Account not found");

    const agg = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId: id,
        journal: { status: "POSTED" },
      },
      _sum: { debit: true, credit: true },
    });
    const debitSum = agg._sum.debit ?? 0;
    const creditSum = agg._sum.credit ?? 0;
    const normalSide = account.category?.normalSide ?? "DEBIT";
    const movement =
      normalSide === "DEBIT" ? debitSum - creditSum : creditSum - debitSum;
    const balance = (account.openingBalance ?? 0) + movement;

    return {
      ...toAccountResponse(account),
      balance,
    };
  }

  async create(
    companyId: string,
    dto: CreateAccountDto,
  ): Promise<AccountResponse> {
    await this.assertCategory(companyId, dto.categoryId);
    if (dto.parentId) await this.assertAccount(companyId, dto.parentId);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    let code = dto.code?.trim();
    if (!code) {
      const cat = await this.prisma.accountCategory.findUnique({
        where: { id: dto.categoryId },
        select: { type: true },
      });
      const prefixMap: Record<string, string> = {
        ASSET: "1",
        LIABILITY: "2",
        EQUITY: "3",
        REVENUE: "4",
        EXPENSE: "5",
      };
      const prefix = prefixMap[cat?.type ?? ""] || "9";
      const last = await this.prisma.account.findFirst({
        where: { code: { startsWith: `${prefix}-` }, category: { companyId } },
        orderBy: { code: "desc" },
        select: { code: true },
      });
      let next = 1001;
      if (last) {
        const parts = last.code.split("-");
        const n = parseInt(parts[1] ?? "0", 10);
        if (!isNaN(n)) next = n + 1;
      }
      code = `${prefix}-${next}`;
    }

    try {
      const created = await this.prisma.account.create({
        data: {
          code,
          name: dto.name,
          description: dto.description ?? null,
          categoryId: dto.categoryId,
          parentId: dto.parentId ?? null,
          branchId: dto.branchId ?? null,
          isActive: dto.isActive ?? true,
          isSystem: dto.isSystem ?? false,
          openingBalance: dto.openingBalance ?? 0,
        },
        select: ACCOUNT_SELECT,
      });
      return toAccountResponse(created);
    } catch (err) {
      throwIfDuplicateCode(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<AccountResponse> {
    const existing = await this.prisma.account.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, code: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException("Account not found");

    if (dto.code !== undefined && dto.code !== existing.code) {
      const linesCount = await this.prisma.journalEntryLine.count({
        where: { accountId: id },
      });
      if (linesCount > 0) {
        throw new BadRequestException(
          "Kode akun tidak bisa diubah karena sudah dipakai pada jurnal",
        );
      }
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException(
          "Akun tidak bisa menjadi parent dirinya sendiri",
        );
      }
      await this.assertAccount(companyId, dto.parentId);
    }

    if (dto.categoryId !== undefined) {
      await this.assertCategory(companyId, dto.categoryId);
    }

    if (dto.branchId !== undefined && dto.branchId !== null) {
      await this.assertBranch(companyId, dto.branchId);
    }

    const data: Prisma.AccountUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isSystem !== undefined) data.isSystem = dto.isSystem;
    if (dto.openingBalance !== undefined) {
      data.openingBalance = dto.openingBalance;
    }

    try {
      const updated = await this.prisma.account.update({
        where: { id },
        data,
        select: ACCOUNT_SELECT,
      });
      return toAccountResponse(updated);
    } catch (err) {
      throwIfDuplicateCode(err);
      throw err;
    }
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.account.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        isSystem: true,
        _count: { select: { children: true, journalLines: true } },
      },
    });
    if (!existing) throw new NotFoundException("Account not found");
    if (existing.isSystem) {
      throw new BadRequestException("Akun sistem tidak bisa dihapus");
    }
    if (existing._count.children > 0) {
      throw new BadRequestException("Akun masih memiliki sub-akun");
    }
    if (existing._count.journalLines > 0) {
      throw new BadRequestException(
        "Akun sudah digunakan pada jurnal, tidak bisa dihapus",
      );
    }
    await this.prisma.account.delete({ where: { id } });
    return { success: true };
  }

  async tree(companyId: string): Promise<AccountTreeResponse> {
    const rows = await this.prisma.account.findMany({
      where: this.tenantWhere(companyId),
      select: {
        id: true,
        code: true,
        name: true,
        categoryId: true,
        parentId: true,
        isActive: true,
        category: { select: { normalSide: true } },
      },
      orderBy: [{ code: "asc" }],
    });

    const map = new Map<string, AccountTreeNode>();
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        code: r.code,
        name: r.name,
        categoryId: r.categoryId,
        parentId: r.parentId,
        isActive: r.isActive,
        normalSide: r.category?.normalSide ?? "DEBIT",
        children: [],
      });
    }

    const roots: AccountTreeNode[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return { tree: roots };
  }

  async treeWithBalance(companyId: string): Promise<unknown[]> {
    const [categories, accounts, balances] = await Promise.all([
      this.prisma.accountCategory.findMany({
        where: { companyId },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.account.findMany({
        where: { isActive: true, category: { companyId } },
        include: {
          category: {
            select: { id: true, name: true, type: true, normalSide: true },
          },
          _count: { select: { children: true, journalLines: true } },
        },
        orderBy: { code: "asc" },
      }),
      this.prisma.$queryRaw<
        Array<{ accountId: string; total_debit: number; total_credit: number }>
      >`
        SELECT jel."accountId",
          COALESCE(SUM(jel.debit), 0)::float AS total_debit,
          COALESCE(SUM(jel.credit), 0)::float AS total_credit
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        JOIN accounts a ON a.id = jel."accountId"
        JOIN account_categories ac ON ac.id = a."categoryId"
        WHERE je.status = 'POSTED' AND ac."companyId" = ${companyId}
        GROUP BY jel."accountId"
      `,
    ]);

    const balanceMap = new Map(balances.map((b) => [b.accountId, b]));
    type Acc = (typeof accounts)[number];
    const tree = categories.map((cat) => {
      const catAccounts = accounts.filter((a) => a.categoryId === cat.id);
      const childMap = new Map<string, Acc[]>();
      for (const acc of catAccounts) {
        if (acc.parentId) {
          const arr = childMap.get(acc.parentId) ?? [];
          arr.push(acc);
          childMap.set(acc.parentId, arr);
        }
      }

      const buildNode = (account: Acc): Record<string, unknown> => {
        const bal = balanceMap.get(account.id);
        const normalSide = cat.normalSide;
        const calculatedBalance =
          normalSide === "DEBIT"
            ? account.openingBalance +
              (bal?.total_debit ?? 0) -
              (bal?.total_credit ?? 0)
            : account.openingBalance +
              (bal?.total_credit ?? 0) -
              (bal?.total_debit ?? 0);
        return {
          ...account,
          openingBalance: calculatedBalance,
          children: (childMap.get(account.id) ?? []).map(buildNode),
        };
      };

      const rootAccounts = catAccounts.filter((a) => !a.parentId);
      return { ...cat, accounts: rootAccounts.map(buildNode) };
    });

    return tree;
  }

  async coaStats(companyId: string): Promise<
    Array<{ category: string; count: number; total_balance: number }>
  > {
    const results = await this.prisma.$queryRaw<
      Array<{ category: string; count: number; total_balance: number }>
    >`
      SELECT ac.type AS category,
        COUNT(DISTINCT a.id)::int AS count,
        COALESCE(SUM(a."openingBalance" + COALESCE(jl.total_debit, 0) - COALESCE(jl.total_credit, 0)), 0)::float AS total_balance
      FROM accounts a
      JOIN account_categories ac ON ac.id = a."categoryId"
      LEFT JOIN (
        SELECT jel."accountId",
          SUM(jel.debit) AS total_debit,
          SUM(jel.credit) AS total_credit
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel."journalId"
        WHERE je.status = 'POSTED'
        GROUP BY jel."accountId"
      ) jl ON jl."accountId" = a.id
      WHERE ac."companyId" = ${companyId} AND a."isActive" = true
      GROUP BY ac.type
    `;
    return results;
  }

  // ===== helpers =====

  private async buildListWhere(
    companyId: string,
    query: ListAccountsQueryDto,
  ): Promise<Prisma.AccountWhereInput> {
    const { search, categoryId, parentId, branchId, type, isActive } = query;
    const where: Prisma.AccountWhereInput = this.tenantWhere(companyId);

    if (categoryId) where.categoryId = categoryId;
    if (parentId !== undefined) where.parentId = parentId;
    if (branchId !== undefined) where.branchId = branchId;
    if (type) {
      where.category = { companyId, type };
    }
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ];
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.AccountWhereInput {
    return { category: { companyId } };
  }

  private async assertCategory(companyId: string, categoryId: string) {
    const cat = await this.prisma.accountCategory.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!cat) throw new NotFoundException("Account category not found");
  }

  private async assertAccount(companyId: string, accountId: string) {
    const acc = await this.prisma.account.findFirst({
      where: { id: accountId, ...this.tenantWhere(companyId) },
      select: { id: true },
    });
    if (!acc) throw new NotFoundException("Parent account not found");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function toAccountResponse(a: RawAccount): AccountResponse {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description,
    categoryId: a.categoryId,
    category: a.category
      ? {
          id: a.category.id,
          name: a.category.name,
          type: a.category.type,
          normalSide: a.category.normalSide,
        }
      : null,
    parentId: a.parentId,
    parent: a.parent
      ? { id: a.parent.id, name: a.parent.name, code: a.parent.code }
      : null,
    branchId: a.branchId,
    branch: a.branch ? { id: a.branch.id, name: a.branch.name } : null,
    isActive: a.isActive,
    isSystem: a.isSystem,
    openingBalance: a.openingBalance,
    childrenCount: a._count.children,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function throwIfDuplicateCode(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Kode akun sudah digunakan");
  }
}
