import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BrandListResponse,
  BrandResponse,
  CreateBrandDto,
  ListBrandsQueryDto,
  UpdateBrandDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const BRAND_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.BrandSelect;

type RawBrand = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListBrandsQueryDto,
  ): Promise<BrandListResponse> {
    const { search, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.BrandWhereInput = { companyId };
    if (search) where.name = { contains: search, mode: "insensitive" };

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.BrandOrderByWithRelationInput = { name: "asc" };
    if (sortBy) {
      switch (sortBy) {
        case "products":
          orderBy = { products: { _count: dir } };
          break;
        case "name":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.BrandOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        select: BRAND_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return {
      brands: rows.map(toBrandResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<BrandResponse> {
    const brand = await this.prisma.brand.findFirst({
      where: { id, companyId },
      select: BRAND_SELECT,
    });
    if (!brand) throw new NotFoundException("Brand not found");
    return toBrandResponse(brand);
  }

  async create(
    companyId: string,
    dto: CreateBrandDto,
  ): Promise<BrandResponse> {
    try {
      const created = await this.prisma.brand.create({
        data: { name: dto.name, companyId },
        select: BRAND_SELECT,
      });
      return toBrandResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Nama brand sudah digunakan");
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateBrandDto,
  ): Promise<BrandResponse> {
    const existing = await this.prisma.brand.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Brand not found");

    const data: Prisma.BrandUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;

    try {
      const updated = await this.prisma.brand.update({
        where: { id },
        data,
        select: BRAND_SELECT,
      });
      return toBrandResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Nama brand sudah digunakan");
      }
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.brand.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { products: true } } },
    });
    if (!existing) throw new NotFoundException("Brand not found");
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Brand masih dipakai ${existing._count.products} produk`,
      );
    }
    await this.prisma.brand.delete({ where: { id } });
    return { success: true };
  }
}

function toBrandResponse(b: RawBrand): BrandResponse {
  return {
    id: b.id,
    name: b.name,
    productCount: b._count.products,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
