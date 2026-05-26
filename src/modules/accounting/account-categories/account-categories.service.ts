import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  AccountCategoryListResponse,
  AccountCategoryResponse,
  CreateAccountCategoryDto,
  ListAccountCategoriesQueryDto,
  UpdateAccountCategoryDto,
} from "../dto/accounting.dto";
import { PrismaService } from "../../prisma/prisma.service";

const CATEGORY_SELECT = {
  id: true,
  name: true,
  type: true,
  normalSide: true,
  sortOrder: true,
  createdAt: true,
  _count: { select: { accounts: true } },
} satisfies Prisma.AccountCategorySelect;

type RawCategory = Prisma.AccountCategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

@Injectable()
export class AccountCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListAccountCategoriesQueryDto,
  ): Promise<AccountCategoryListResponse> {
    const { search, type, page, perPage } = query;
    const where: Prisma.AccountCategoryWhereInput = { companyId };
    if (type) where.type = type;
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      this.prisma.accountCategory.findMany({
        where,
        select: CATEGORY_SELECT,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.accountCategory.count({ where }),
    ]);

    return {
      categories: rows.map(toCategoryResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<AccountCategoryResponse> {
    const category = await this.prisma.accountCategory.findFirst({
      where: { id, companyId },
      select: CATEGORY_SELECT,
    });
    if (!category) throw new NotFoundException("Account category not found");
    return toCategoryResponse(category);
  }

  async create(
    companyId: string,
    dto: CreateAccountCategoryDto,
  ): Promise<AccountCategoryResponse> {
    try {
      const created = await this.prisma.accountCategory.create({
        data: {
          name: dto.name,
          type: dto.type,
          normalSide: dto.normalSide,
          sortOrder: dto.sortOrder ?? 0,
          companyId,
        },
        select: CATEGORY_SELECT,
      });
      return toCategoryResponse(created);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateAccountCategoryDto,
  ): Promise<AccountCategoryResponse> {
    const existing = await this.prisma.accountCategory.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Account category not found");

    const data: Prisma.AccountCategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.normalSide !== undefined) data.normalSide = dto.normalSide;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    try {
      const updated = await this.prisma.accountCategory.update({
        where: { id },
        data,
        select: CATEGORY_SELECT,
      });
      return toCategoryResponse(updated);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.accountCategory.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { accounts: true } } },
    });
    if (!existing) throw new NotFoundException("Account category not found");
    if (existing._count.accounts > 0) {
      throw new BadRequestException(
        `Kategori masih dipakai ${existing._count.accounts} akun`,
      );
    }
    await this.prisma.accountCategory.delete({ where: { id } });
    return { success: true };
  }

  async seedDefaultCoa(
    companyId: string,
  ): Promise<{
    message: string;
    categoriesCreated?: number;
    accountsCreated?: number;
  }> {
    const existing = await this.prisma.accountCategory.count({
      where: { companyId },
    });
    if (existing > 0) {
      return { message: "Default COA already exists. Skipping seed." };
    }
    const categories = [
      { name: "Aset", type: "ASSET", normalSide: "DEBIT", sortOrder: 1 },
      {
        name: "Kewajiban",
        type: "LIABILITY",
        normalSide: "CREDIT",
        sortOrder: 2,
      },
      { name: "Modal", type: "EQUITY", normalSide: "CREDIT", sortOrder: 3 },
      {
        name: "Pendapatan",
        type: "REVENUE",
        normalSide: "CREDIT",
        sortOrder: 4,
      },
      { name: "Beban", type: "EXPENSE", normalSide: "DEBIT", sortOrder: 5 },
    ];
    const createdCategories = await this.prisma.$transaction(
      categories.map((cat) =>
        this.prisma.accountCategory.create({ data: { ...cat, companyId } }),
      ),
    );
    const categoryMap = new Map(
      createdCategories.map((c) => [c.type, c.id]),
    );

    const systemAccounts = [
      { code: "1-1001", name: "Kas", categoryType: "ASSET", description: "Kas tunai" },
      { code: "1-1002", name: "Bank", categoryType: "ASSET", description: "Rekening bank" },
      { code: "1-1003", name: "Piutang Dagang", categoryType: "ASSET", description: "Piutang dari pelanggan" },
      { code: "1-1004", name: "Persediaan Barang", categoryType: "ASSET", description: "Persediaan barang dagangan" },
      { code: "2-1001", name: "Hutang Dagang", categoryType: "LIABILITY", description: "Hutang ke supplier" },
      { code: "4-1001", name: "Pendapatan Penjualan", categoryType: "REVENUE", description: "Pendapatan dari penjualan barang" },
      { code: "4-1002", name: "Retur Penjualan", categoryType: "REVENUE", description: "Contra revenue â€” retur penjualan" },
      { code: "5-1001", name: "Harga Pokok Penjualan", categoryType: "EXPENSE", description: "HPP / COGS" },
      { code: "5-1002", name: "Beban Operasional", categoryType: "EXPENSE", description: "Beban operasional umum" },
      { code: "5-1003", name: "Beban Gaji", categoryType: "EXPENSE", description: "Beban gaji karyawan" },
      { code: "2-1100", name: "PPN Keluaran", categoryType: "LIABILITY", description: "PPN yang dipungut dari penjualan" },
      { code: "1-1100", name: "PPN Masukan", categoryType: "ASSET", description: "PPN yang dibayar atas pembelian" },
      { code: "2-1200", name: "Hutang PPh 21", categoryType: "LIABILITY", description: "PPh 21 yang dipotong dari gaji" },
      { code: "2-1201", name: "Hutang PPh 23", categoryType: "LIABILITY", description: "PPh 23 atas jasa/sewa" },
      { code: "5-1010", name: "Beban PPh 23", categoryType: "EXPENSE", description: "Beban pajak PPh 23" },
    ];
    await this.prisma.$transaction(
      systemAccounts.map((acc) =>
        this.prisma.account.create({
          data: {
            code: acc.code,
            name: acc.name,
            description: acc.description,
            categoryId: categoryMap.get(acc.categoryType)!,
            isSystem: true,
            isActive: true,
            openingBalance: 0,
          },
        }),
      ),
    );
    return {
      message: "Default COA seeded successfully",
      categoriesCreated: categories.length,
      accountsCreated: systemAccounts.length,
    };
  }

  async backfillJournals(
    companyId: string,
  ): Promise<{ created: number; failed: number; total: number }> {
    // Stub â€” backfill memerlukan auto-journal call per record yang banyak.
    // Untuk safety, return 0 â€” endpoint tetap tersedia untuk extension future.
    void companyId;
    return { created: 0, failed: 0, total: 0 };
  }
}

function toCategoryResponse(c: RawCategory): AccountCategoryResponse {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    normalSide: c.normalSide,
    sortOrder: c.sortOrder,
    accountCount: c._count.accounts,
    createdAt: c.createdAt.toISOString(),
  };
}

function throwIfDuplicate(err: unknown): void {
  throwIfUniqueConstraint(err, "Kategori akun untuk tipe ini sudah ada di perusahaan");
}
