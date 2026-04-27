import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CategoryListResponse,
  CategoryResponse,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  parentId: true,
  parent: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.CategorySelect;

type RawCategory = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListCategoriesQueryDto,
  ): Promise<CategoryListResponse> {
    const { search, parentId, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.CategoryWhereInput = { companyId };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (parentId !== undefined) where.parentId = parentId;

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
      this.prisma.category.findMany({
        where,
        select: CATEGORY_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      categories: rows.map(toCategoryResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<CategoryResponse> {
    const category = await this.prisma.category.findFirst({
      where: { id, companyId },
      select: CATEGORY_SELECT,
    });
    if (!category) throw new NotFoundException("Category not found");
    return toCategoryResponse(category);
  }

  async create(
    companyId: string,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    if (dto.parentId) await this.ensureSameCompany(companyId, dto.parentId);
    try {
      const created = await this.prisma.category.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          parentId: dto.parentId ?? null,
          companyId,
        },
        select: CATEGORY_SELECT,
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
    const existing = await this.prisma.category.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Category not found");

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException("Kategori tidak bisa menjadi parent dirinya");
      }
      await this.ensureSameCompany(companyId, dto.parentId);
    }

    const data: Prisma.CategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data,
        select: CATEGORY_SELECT,
      });
      this.realtime.emit(EVENTS.CATEGORY_UPDATED, { categoryId: updated.id });
      return toCategoryResponse(updated);
    } catch (err) {
      throwIfDuplicateName(err, "Nama kategori sudah digunakan");
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.category.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { products: true, children: true } } },
    });
    if (!existing) throw new NotFoundException("Category not found");
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Kategori masih dipakai ${existing._count.products} produk`,
      );
    }
    if (existing._count.children > 0) {
      throw new BadRequestException("Kategori masih memiliki sub-kategori");
    }
    await this.prisma.category.delete({ where: { id } });
    this.realtime.emit(EVENTS.CATEGORY_UPDATED, { categoryId: id });
    return { success: true };
  }

  private async ensureSameCompany(companyId: string, parentId: string) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException("Parent category not found");
  }
}

function toCategoryResponse(c: RawCategory): CategoryResponse {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    parentId: c.parentId,
    parent: c.parent ? { id: c.parent.id, name: c.parent.name } : null,
    productCount: c._count.products,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function throwIfDuplicateName(err: unknown, message: string): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(message);
  }
}
