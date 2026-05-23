import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierListResponse,
  SupplierResponse,
  UpdateSupplierDto,
} from "./dto/suppliers.dto";
import { SuppliersRepository, type RawSupplier } from "./suppliers.repository";

@Injectable()
export class SuppliersService {
  constructor(private readonly repo: SuppliersRepository) {}

  async list(
    companyId: string,
    query: ListSuppliersQueryDto,
  ): Promise<SupplierListResponse> {
    const { search, isActive, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.SupplierWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { contact: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.SupplierOrderByWithRelationInput = { name: "asc" };
    if (sortBy) {
      switch (sortBy) {
        case "products":
          orderBy = { products: { _count: dir } };
          break;
        case "name":
        case "contact":
        case "email":
        case "isActive":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.SupplierOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return {
      suppliers: rows.map(toSupplierResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<SupplierResponse> {
    const supplier = await this.repo.findOne({ id, companyId });
    if (!supplier) throw new NotFoundException("Supplier not found");
    return toSupplierResponse(supplier);
  }

  async create(
    companyId: string,
    dto: CreateSupplierDto,
  ): Promise<SupplierResponse> {
    const created = await this.repo.create({
      name: dto.name,
      contact: dto.contact ?? null,
      address: dto.address ?? null,
      email: dto.email ?? null,
      isActive: dto.isActive ?? true,
      companyId,
    });
    return toSupplierResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    const existing = await this.repo.findOne({ id, companyId });
    if (!existing) throw new NotFoundException("Supplier not found");

    const data: Prisma.SupplierUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.contact !== undefined) data.contact = dto.contact;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.repo.update(id, data);
    return toSupplierResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findWithCounts(companyId, id);
    if (!existing) throw new NotFoundException("Supplier not found");
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Supplier masih dipakai ${existing._count.products} produk`,
      );
    }
    await this.repo.delete(id);
    return { success: true };
  }
}

function toSupplierResponse(s: RawSupplier): SupplierResponse {
  return {
    id: s.id,
    name: s.name,
    contact: s.contact,
    address: s.address,
    email: s.email,
    isActive: s.isActive,
    productCount: s._count.products,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
