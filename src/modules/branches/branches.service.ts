import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  BranchResponse,
  CreateBranchDto,
  ListBranchesQueryDto,
  UpdateBranchDto,
} from "./dto/branches.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { BranchesRepository, type RawBranch } from "./branches.repository";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

@Injectable()
export class BranchesService {
  constructor(
    private readonly repo: BranchesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListBranchesQueryDto,
  ): Promise<PaginatedResponse<BranchResponse>> {
    const { search, isActive, page, perPage } = query;
    const where: Prisma.BranchWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toBranchResponse), total, page, perPage);
  }

  async summary(companyId: string) {
    const where: Prisma.BranchWhereInput = { companyId };
    const [total, active] = await Promise.all([
      this.repo.count(where),
      this.repo.count({ ...where, isActive: true }),
    ]);
    return { total, active, inactive: total - active };
  }

  async findById(companyId: string, id: string): Promise<BranchResponse> {
    const branch = await this.repo.findOne({ id, companyId });
    if (!branch) throw new NotFoundException("Branch not found");
    return toBranchResponse(branch);
  }

  async create(
    companyId: string,
    dto: CreateBranchDto,
  ): Promise<BranchResponse> {
    try {
      const created = await this.repo.create({
        name: dto.name,
        code: dto.code ?? null,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        isActive: dto.isActive ?? true,
        companyId,
      });
      this.realtime.emit(EVENTS.BRANCH_UPDATED, { branchId: created.id });
      return toBranchResponse(created);
    } catch (err) {
      throwOnDupBranch(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("Branch not found");

    const data: Prisma.BranchUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const updated = await this.repo.update(id, data);
      this.realtime.emit(EVENTS.BRANCH_UPDATED, { branchId: updated.id });
      return toBranchResponse(updated);
    } catch (err) {
      throwOnDupBranch(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findWithCounts(companyId, id);
    if (!existing) throw new NotFoundException("Branch not found");
    if (existing._count.users > 0) {
      throw new BadRequestException(
        `Branch masih dipakai ${existing._count.users} user`,
      );
    }
    if (existing._count.transactions > 0) {
      throw new BadRequestException(
        `Branch memiliki ${existing._count.transactions} transaksi, tidak bisa dihapus`,
      );
    }
    await this.repo.delete(id);
    this.realtime.emit(EVENTS.BRANCH_UPDATED, { branchId: id });
    return { success: true };
  }
}

function toBranchResponse(b: RawBranch): BranchResponse {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    address: b.address,
    phone: b.phone,
    latitude: b.latitude,
    longitude: b.longitude,
    isActive: b.isActive,
    userCount: b._count.users,
    transactionCount: b._count.transactions,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function throwOnDupBranch(err: unknown): void {
  throwIfUniqueConstraint(err, "Nama atau kode branch sudah digunakan");
}
