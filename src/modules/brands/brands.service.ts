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
} from "./dto/brands.dto";
import { BrandsRepository, type RawBrand } from "./brands.repository";

@Injectable()
export class BrandsService {
  constructor(private readonly repo: BrandsRepository) {}

  async list(
    companyId: string,
    query: ListBrandsQueryDto,
  ): Promise<BrandListResponse> {
    const { search, kind, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.BrandWhereInput = { companyId };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (kind) where.kind = kind;

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
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return {
      brands: rows.map(toBrandResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<BrandResponse> {
    const brand = await this.repo.findOne({ id, companyId });
    if (!brand) throw new NotFoundException("Brand not found");
    return toBrandResponse(brand);
  }

  async create(
    companyId: string,
    dto: CreateBrandDto,
  ): Promise<BrandResponse> {
    try {
      const created = await this.repo.create({
        name: dto.name,
        kind: dto.kind ?? "PRODUCT",
        companyId,
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
    const existing = await this.repo.findOne({ id, companyId });
    if (!existing) throw new NotFoundException("Brand not found");

    const data: Prisma.BrandUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.kind !== undefined) data.kind = dto.kind;

    try {
      const updated = await this.repo.update(id, data);
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
    const existing = await this.repo.findWithCounts(companyId, id);
    if (!existing) throw new NotFoundException("Brand not found");
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Brand masih dipakai ${existing._count.products} produk`,
      );
    }
    await this.repo.delete(id);
    return { success: true };
  }
}

function toBrandResponse(b: RawBrand): BrandResponse {
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    productCount: b._count.products,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
