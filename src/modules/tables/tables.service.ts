import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateTableDto,
  ListTablesQueryDto,
  TableResponse,
  TableStatusDto,
  UpdateTableDto,
} from "./dto/tables.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { TablesRepository, type RawTable } from "./tables.repository";

@Injectable()
export class TablesService {
  constructor(private readonly repo: TablesRepository) {}

  async list(
    companyId: string,
    query: ListTablesQueryDto,
  ): Promise<PaginatedResponse<TableResponse>> {
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
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toTableResponse), total, page, perPage);
  }

  async summary(companyId: string, branchId?: string) {
    const base: Prisma.RestaurantTableWhereInput = {
      branch: { companyId },
      ...(branchId ? { branchId } : {}),
    };
    const activeWhere = { ...base, isActive: true };

    const [total, active, statusCounts, sectionCounts] = await Promise.all([
      this.repo.count(base),
      this.repo.count(activeWhere),
      this.repo.statusCounts(activeWhere),
      this.repo.sectionCounts(activeWhere),
    ]);

    const statusMap = new Map(statusCounts.map((r) => [r.status, r._count]));
    const sectionMap = new Map(sectionCounts.map((r) => [r.section, r._count]));

    return {
      total,
      active,
      available: statusMap.get("AVAILABLE") ?? 0,
      occupied: statusMap.get("OCCUPIED") ?? 0,
      reserved: statusMap.get("RESERVED") ?? 0,
      cleaning: statusMap.get("CLEANING") ?? 0,
      sections: sectionCounts
        .filter((r) => r.section !== null)
        .map((r) => ({ name: r.section!, count: r._count })),
      noSectionCount: sectionMap.get(null) ?? 0,
    };
  }

  async findById(companyId: string, id: string): Promise<TableResponse> {
    const table = await this.repo.findOne({ id, branch: { companyId } });
    if (!table) throw new NotFoundException("Meja tidak ditemukan");
    return toTableResponse(table);
  }

  async create(
    companyId: string,
    dto: CreateTableDto,
  ): Promise<TableResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    try {
      const created = await this.repo.create({
        number: dto.number,
        name: dto.name ?? null,
        capacity: dto.capacity ?? 4,
        branchId: dto.branchId ?? null,
        section: dto.section ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      });
      return toTableResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Nomor meja sudah digunakan di cabang ini");
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
      const updated = await this.repo.update(id, data);
      return toTableResponse(updated);
    } catch (err) {
      throwIfUniqueConstraint(err, "Nomor meja sudah digunakan di cabang ini");
    }
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: TableStatusDto,
  ): Promise<TableResponse> {
    await this.ensureOwned(companyId, id);
    const updated = await this.repo.update(id, { status });
    return toTableResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    await this.ensureOwned(companyId, id);
    await this.repo.delete(id);
    return { success: true };
  }

  async generateQrToken(companyId: string, id: string): Promise<TableResponse> {
    await this.ensureOwned(companyId, id);
    let attempts = 0;
    while (attempts < 5) {
      const token = randomToken();
      try {
        const updated = await this.repo.update(id, { qrToken: token });
        return toTableResponse(updated);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          attempts++;
          continue;
        }
        throw err;
      }
    }
    throw new Error("Gagal generate token unik");
  }

  private async ensureOwned(companyId: string, id: string) {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("Meja tidak ditemukan");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.repo.findBranch(companyId, branchId);
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
    qrToken: t.qrToken,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function randomToken(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 24; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
