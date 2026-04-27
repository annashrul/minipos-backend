import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateTableDto,
  ListTablesQueryDto,
  TableListResponse,
  TableResponse,
  TableStatusDto,
  UpdateTableDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const TABLE_SELECT = {
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RestaurantTableSelect;

type RawTable = Prisma.RestaurantTableGetPayload<{ select: typeof TABLE_SELECT }>;

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListTablesQueryDto,
  ): Promise<TableListResponse> {
    const { branchId, status, section, isActive, search, page, perPage } =
      query;

    const where: Prisma.RestaurantTableWhereInput = {
      branch: { companyId },
    };
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (section) where.section = section;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { section: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.restaurantTable.findMany({
        where,
        select: TABLE_SELECT,
        orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.restaurantTable.count({ where }),
    ]);

    return {
      tables: rows.map(toTableResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<TableResponse> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id, branch: { companyId } },
      select: TABLE_SELECT,
    });
    if (!table) throw new NotFoundException("Table not found");
    return toTableResponse(table);
  }

  async create(
    companyId: string,
    dto: CreateTableDto,
  ): Promise<TableResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    try {
      const created = await this.prisma.restaurantTable.create({
        data: {
          number: dto.number,
          name: dto.name ?? null,
          capacity: dto.capacity ?? 4,
          branchId: dto.branchId ?? null,
          section: dto.section ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        select: TABLE_SELECT,
      });
      return toTableResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(
          "Nomor meja sudah digunakan di cabang ini",
        );
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTableDto,
  ): Promise<TableResponse> {
    await this.ensureOwned(companyId, id);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const data: Prisma.RestaurantTableUpdateInput = {};
    if (dto.number !== undefined) data.number = dto.number;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.section !== undefined) data.section = dto.section;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.prisma.restaurantTable.update({
        where: { id },
        data,
        select: TABLE_SELECT,
      });
      return toTableResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(
          "Nomor meja sudah digunakan di cabang ini",
        );
      }
      throw err;
    }
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: TableStatusDto,
  ): Promise<TableResponse> {
    await this.ensureOwned(companyId, id);
    const updated = await this.prisma.restaurantTable.update({
      where: { id },
      data: { status },
      select: TABLE_SELECT,
    });
    return toTableResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    await this.ensureOwned(companyId, id);
    await this.prisma.restaurantTable.delete({ where: { id } });
    return { success: true };
  }

  private async ensureOwned(companyId: string, id: string) {
    const existing = await this.prisma.restaurantTable.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Table not found");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function toTableResponse(t: RawTable): TableResponse {
  return {
    id: t.id,
    number: t.number,
    name: t.name,
    capacity: t.capacity,
    status: t.status,
    branchId: t.branchId,
    branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
    section: t.section,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
