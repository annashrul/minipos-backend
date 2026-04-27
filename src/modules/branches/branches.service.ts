import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BranchListResponse,
  BranchResponse,
  CreateBranchDto,
  ListBranchesQueryDto,
  UpdateBranchDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

const BRANCH_SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  phone: true,
  latitude: true,
  longitude: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true, transactions: true } },
} satisfies Prisma.BranchSelect;

type RawBranch = Prisma.BranchGetPayload<{ select: typeof BRANCH_SELECT }>;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListBranchesQueryDto,
  ): Promise<BranchListResponse> {
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
      this.prisma.branch.findMany({
        where,
        select: BRANCH_SELECT,
        orderBy: { name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.branch.count({ where }),
    ]);

    return {
      branches: rows.map(toBranchResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<BranchResponse> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId },
      select: BRANCH_SELECT,
    });
    if (!branch) throw new NotFoundException("Branch not found");
    return toBranchResponse(branch);
  }

  async create(
    companyId: string,
    dto: CreateBranchDto,
  ): Promise<BranchResponse> {
    try {
      const created = await this.prisma.branch.create({
        data: {
          name: dto.name,
          code: dto.code ?? null,
          address: dto.address ?? null,
          phone: dto.phone ?? null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isActive: dto.isActive ?? true,
          companyId,
        },
        select: BRANCH_SELECT,
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
    const existing = await this.prisma.branch.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
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
      const updated = await this.prisma.branch.update({
        where: { id },
        data,
        select: BRANCH_SELECT,
      });
      this.realtime.emit(EVENTS.BRANCH_UPDATED, { branchId: updated.id });
      return toBranchResponse(updated);
    } catch (err) {
      throwOnDupBranch(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.branch.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        _count: { select: { users: true, transactions: true } },
      },
    });
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
    await this.prisma.branch.delete({ where: { id } });
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
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Nama atau kode branch sudah digunakan");
  }
}
