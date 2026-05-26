import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const BRAND_SELECT = {
  id: true,
  name: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.BrandSelect;

export type RawBrand = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.BrandWhereInput,
    orderBy: Prisma.BrandOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawBrand[]> {
    return this.prisma.brand.findMany({
      where,
      select: BRAND_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.BrandWhereInput): Promise<number> {
    return this.prisma.brand.count({ where });
  }

  async findOne(where: Prisma.BrandWhereInput): Promise<RawBrand | null> {
    return this.prisma.brand.findFirst({
      where,
      select: BRAND_SELECT,
    });
  }

  async findWithCounts(
    companyId: string,
    id: string,
  ): Promise<{ id: string; _count: { products: number } } | null> {
    return this.prisma.brand.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { products: true } } },
    });
  }

  async create(data: Prisma.BrandUncheckedCreateInput): Promise<RawBrand> {
    return this.prisma.brand.create({
      data,
      select: BRAND_SELECT,
    });
  }

  async update(id: string, data: Prisma.BrandUpdateInput): Promise<RawBrand> {
    return this.prisma.brand.update({
      where: { id },
      data,
      select: BRAND_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.brand.delete({ where: { id } });
  }
}
