import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  BrandResponse,
  CreateBrandDto,
  ListBrandsQueryDto,
  UpdateBrandDto,
} from "./dto/brands.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { BrandsRepository, type RawBrand } from "./brands.repository";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BrandsService {
  constructor(
    private readonly repo: BrandsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async summary(companyId: string) {
    const where = { companyId };
    const [total, withProducts] = await Promise.all([
      this.prisma.brand.count({ where }),
      this.prisma.brand.count({ where: { ...where, products: { some: { deletedAt: null } } } }),
    ]);
    return { total, withProducts, withoutProducts: total - withProducts };
  }

  async list(
    companyId: string,
    query: ListBrandsQueryDto,
  ): Promise<PaginatedResponse<BrandResponse>> {
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

    return paginate(rows.map(toBrandResponse), total, page, perPage);
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
      throwIfUniqueConstraint(err, "Nama brand sudah digunakan");
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
      throwIfUniqueConstraint(err, "Nama brand sudah digunakan");
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

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ count: number; skipped: string[] }> {
    const [count, skipped] = await Promise.all([
      this.repo.deleteManyWithoutProducts(companyId, ids),
      this.repo.findSkipped(companyId, ids),
    ]);
    return { count, skipped };
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
