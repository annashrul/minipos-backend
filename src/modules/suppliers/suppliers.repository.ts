import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contact: true,
  address: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
} satisfies Prisma.SupplierSelect;

export type RawSupplier = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_SELECT;
}>;

@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.SupplierWhereInput,
    orderBy: Prisma.SupplierOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawSupplier[]> {
    return this.prisma.supplier.findMany({
      where,
      select: SUPPLIER_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.SupplierWhereInput): Promise<number> {
    return this.prisma.supplier.count({ where });
  }

  async findOne(
    where: Prisma.SupplierWhereInput,
  ): Promise<RawSupplier | null> {
    return this.prisma.supplier.findFirst({
      where,
      select: SUPPLIER_SELECT,
    });
  }

  async findWithCounts(
    companyId: string,
    id: string,
  ): Promise<{ id: string; _count: { products: number } } | null> {
    return this.prisma.supplier.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { products: { where: { deletedAt: null } } } } },
    });
  }

  async create(data: Prisma.SupplierUncheckedCreateInput): Promise<RawSupplier> {
    return this.prisma.supplier.create({
      data,
      select: SUPPLIER_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.SupplierUpdateInput,
  ): Promise<RawSupplier> {
    return this.prisma.supplier.update({
      where: { id },
      data,
      select: SUPPLIER_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.supplier.delete({ where: { id } });
  }
}
