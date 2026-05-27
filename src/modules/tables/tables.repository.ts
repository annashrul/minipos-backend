import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const TABLE_SELECT = {
  id: true,
  number: true,
  name: true,
  capacity: true,
  status: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  section: true,
  sortOrder: true,
  isActive: true,
  qrToken: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RestaurantTableSelect;

export type RawTable = Prisma.RestaurantTableGetPayload<{
  select: typeof TABLE_SELECT;
}>;

@Injectable()
export class TablesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.RestaurantTableWhereInput,
    skip: number,
    take: number,
  ): Promise<RawTable[]> {
    return this.prisma.restaurantTable.findMany({
      where,
      select: TABLE_SELECT,
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      skip,
      take,
    });
  }

  async count(where: Prisma.RestaurantTableWhereInput): Promise<number> {
    return this.prisma.restaurantTable.count({ where });
  }

  async findOne(
    where: Prisma.RestaurantTableWhereInput,
  ): Promise<RawTable | null> {
    return this.prisma.restaurantTable.findFirst({
      where,
      select: TABLE_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.restaurantTable.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true },
    });
  }

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async create(
    data: Prisma.RestaurantTableUncheckedCreateInput,
  ): Promise<RawTable> {
    return this.prisma.restaurantTable.create({
      data,
      select: TABLE_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.RestaurantTableUpdateInput,
  ): Promise<RawTable> {
    return this.prisma.restaurantTable.update({
      where: { id },
      data,
      select: TABLE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.restaurantTable.delete({ where: { id } });
  }

  async statusCounts(
    where: Prisma.RestaurantTableWhereInput,
  ): Promise<{ status: string; _count: number }[]> {
    const rows = await this.prisma.restaurantTable.groupBy({
      by: ["status"],
      where,
      _count: true,
    });
    return rows.map((r) => ({ status: r.status, _count: r._count }));
  }

  async sectionCounts(
    where: Prisma.RestaurantTableWhereInput,
  ): Promise<{ section: string | null; _count: number }[]> {
    const rows = await this.prisma.restaurantTable.groupBy({
      by: ["section"],
      where,
      _count: true,
      orderBy: { section: "asc" },
    });
    return rows.map((r) => ({ section: r.section, _count: r._count }));
  }
}
