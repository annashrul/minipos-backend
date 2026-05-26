import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  parentId: true,
  parent: { select: { id: true, name: true } },
  kind: true,
  brandId: true,
  brand: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
} satisfies Prisma.CategorySelect;

export type RawCategory = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.CategoryWhereInput,
    orderBy: Prisma.CategoryOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawCategory[]> {
    return this.prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.CategoryWhereInput): Promise<number> {
    return this.prisma.category.count({ where });
  }

  async findOne(
    where: Prisma.CategoryWhereInput,
  ): Promise<RawCategory | null> {
    return this.prisma.category.findFirst({
      where,
      select: CATEGORY_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.category.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
  }

  async findWithCounts(
    companyId: string,
    id: string,
  ): Promise<{
    id: string;
    _count: { products: number; children: number };
  } | null> {
    return this.prisma.category.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        _count: { select: { products: { where: { deletedAt: null } }, children: true } },
      },
    });
  }

  async create(data: Prisma.CategoryUncheckedCreateInput): Promise<RawCategory> {
    return this.prisma.category.create({
      data,
      select: CATEGORY_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.CategoryUpdateInput,
  ): Promise<RawCategory> {
    return this.prisma.category.update({
      where: { id },
      data,
      select: CATEGORY_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.category.delete({ where: { id } });
  }
}
