import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import { AssertService } from "@/common/assert/assert.service";
import type {
  CategoryResponse,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from "./dto/categories.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { CategoriesRepository, type RawCategory } from "./categories.repository";
import { RealtimeService, EVENTS } from "@/modules/realtime/realtime.service";
import { PrismaService } from "@/modules/prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly repo: CategoriesRepository,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
    private readonly assert: AssertService,
  ) {}

  async summary(companyId: string) {
    const where = { companyId };
    const [total, withProducts] = await Promise.all([
      this.prisma.category.count({ where }),
      this.prisma.category.count({ where: { ...where, products: { some: { deletedAt: null } } } }),
    ]);
    return { total, withProducts, empty: total - withProducts };
  }

  async list(
    companyId: string,
    query: ListCategoriesQueryDto,
  ): Promise<PaginatedResponse<CategoryResponse>> {
    const {
      search,
      parentId,
      kind,
      brandId,
      sellableOnly,
      branchId,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;
    const where: Prisma.CategoryWhereInput = { companyId };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (parentId !== undefined) where.parentId = parentId;
    if (kind) where.kind = kind;
    if (brandId) where.brandId = brandId;
    if (sellableOnly) {
      where.products = {
        some: {
          companyId,
          isActive: true,
          deletedAt: null,
          itemType: { not: "INGREDIENT" },
          ...(branchId
            ? {
                OR: [
                  { branchStocks: { some: { branchId } } },
                  { branchPrices: { some: { branchId } } },
                ],
              }
            : {}),
        },
      };
    }

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.CategoryOrderByWithRelationInput = { name: "asc" };
    if (sortBy) {
      switch (sortBy) {
        case "products":
          orderBy = { products: { _count: dir } };
          break;
        case "name":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.CategoryOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toCategoryResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<CategoryResponse> {
    const category = await this.repo.findOne({ id, companyId });
    if (!category) throw new NotFoundException("Kategori tidak ditemukan");
    return toCategoryResponse(category);
  }

  async create(
    companyId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    if (dto.parentId) await this.assert.category(companyId, dto.parentId);
    try {
      const created = await this.repo.create({
        name: dto.name,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        kind: dto.kind ?? "PRODUCT",
        brandId: dto.brandId ?? null,
        companyId,
      });
      this.realtime.emit(EVENTS.CATEGORY_UPDATED, { categoryId: created.id });
      return toCategoryResponse(created);
    } catch (err) {
      throwIfDuplicateName(err, "Nama kategori sudah digunakan");
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("Kategori tidak ditemukan");

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException("Kategori tidak bisa menjadi parent dirinya");
      }
      await this.assert.category(companyId, dto.parentId);
    }

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.brandId !== undefined) {
      data.brand = dto.brandId
        ? { connect: { id: dto.brandId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.repo.update(id, data);
      this.realtime.emit(EVENTS.CATEGORY_UPDATED, { categoryId: updated.id });
      return toCategoryResponse(updated);
    } catch (err) {
      throwIfDuplicateName(err, "Nama kategori sudah digunakan");
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findWithCounts(companyId, id);
    if (!existing) throw new NotFoundException("Kategori tidak ditemukan");
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Kategori masih dipakai ${existing._count.products} produk`,
      );
    }
    if (existing._count.children > 0) {
      throw new BadRequestException("Kategori masih memiliki sub-kategori");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.product.deleteMany({ where: { categoryId: id, deletedAt: { not: null } } });
      await tx.category.delete({ where: { id } });
    });
    this.realtime.emit(EVENTS.CATEGORY_UPDATED, { categoryId: id });
    return { success: true };
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ count: number; skipped: string[] }> {
    const activeProductFilter = { deletedAt: null };
    const [skippedRows, deletableRows] = await Promise.all([
      this.prisma.category.findMany({
        where: {
          id: { in: ids },
          companyId,
          OR: [
            { products: { some: activeProductFilter } },
            { children: { some: {} } },
          ],
        },
        select: { name: true },
      }),
      this.prisma.category.findMany({
        where: {
          id: { in: ids },
          companyId,
          products: { none: activeProductFilter },
          children: { none: {} },
        },
        select: { id: true },
      }),
    ]);
    const deletableIds = deletableRows.map((r) => r.id);
    let count = 0;
    if (deletableIds.length > 0) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.product.deleteMany({ where: { categoryId: { in: deletableIds }, deletedAt: { not: null } } });
        return tx.category.deleteMany({ where: { id: { in: deletableIds } } });
      });
      count = result.count;
    }
    if (count > 0) this.realtime.emit(EVENTS.CATEGORY_UPDATED, {});
    return { count, skipped: skippedRows.map((r) => r.name) };
  }

}

function toCategoryResponse(c: RawCategory): CategoryResponse {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    parentId: c.parentId,
    parent: c.parent ? { id: c.parent.id, name: c.parent.name } : null,
    kind: c.kind,
    brandId: c.brandId,
    brand: c.brand ? { id: c.brand.id, name: c.brand.name } : null,
    productCount: c._count.products,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function throwIfDuplicateName(err: unknown, message: string): void {
  throwIfUniqueConstraint(err, message);
}
