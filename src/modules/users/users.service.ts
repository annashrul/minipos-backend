import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UserResponse,
} from "./dto/users.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { UsersRepository, type RawUser } from "./users.repository";

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async list(companyId: string, query: ListUsersQueryDto): Promise<PaginatedResponse<UserResponse>> {
    const { search, role, branchId, isMechanic, page, perPage } = query;
    const where: Prisma.UserWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (role && role !== "all") where.role = role;
    if (branchId && branchId !== "ALL") where.branchId = branchId;
    if (typeof isMechanic === "boolean") where.isMechanic = isMechanic;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toUserResponse), total, page, perPage);
  }

  async summary(companyId: string, branchId?: string) {
    const where: Prisma.UserWhereInput = { companyId };
    if (branchId) where.branchId = branchId;

    const [total, active] = await Promise.all([
      this.repo.count(where),
      this.repo.count({ ...where, isActive: true }),
    ]);

    const roleRows = await this.repo.groupByRole(where, 5);
    const topRoles: [string, number][] = roleRows.map((r) => [r.role, r._count._all]);

    return { total, active, topRoles };
  }

  async findById(companyId: string, id: string): Promise<UserResponse> {
    const user = await this.repo.findOne({ id, companyId });
    if (!user) throw new NotFoundException("User not found");
    return toUserResponse(user);
  }

  async create(companyId: string, dto: CreateUserDto): Promise<UserResponse> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException("Email sudah digunakan");

    const hashed = await bcrypt.hash(dto.password, 10);
    const hashedAuth = dto.authorizationPassword
      ? await bcrypt.hash(dto.authorizationPassword, 10)
      : null;

    const primaryBranchId =
      dto.branchId ??
      (dto.branchIds && dto.branchIds.length > 0 ? dto.branchIds[0] : null) ??
      null;
    const allBranchIds =
      dto.branchIds && dto.branchIds.length > 0
        ? Array.from(new Set(dto.branchIds))
        : primaryBranchId
          ? [primaryBranchId]
          : [];

    const created = await this.repo.create({
      name: dto.name,
      email: dto.email,
      password: hashed,
      authorizationPassword: hashedAuth,
      role: dto.role,
      isActive: dto.isActive ?? true,
      isMechanic: dto.isMechanic ?? false,
      emailVerified: true,
      company: { connect: { id: companyId } },
      ...(primaryBranchId
        ? { branch: { connect: { id: primaryBranchId } } }
        : {}),
      ...(allBranchIds.length > 0
        ? {
            branches: {
              create: allBranchIds.map((bid) => ({ branchId: bid })),
            },
          }
        : {}),
    });
    return toUserResponse(created);
  }

  async update(companyId: string, id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("User not found");

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isMechanic !== undefined) data.isMechanic = dto.isMechanic;
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId ? { connect: { id: dto.branchId } } : { disconnect: true };
    }
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }
    if (dto.authorizationPassword !== undefined) {
      data.authorizationPassword = dto.authorizationPassword
        ? await bcrypt.hash(dto.authorizationPassword, 10)
        : null;
    }

    if (dto.branchIds !== undefined) {
      const newBranchIds = Array.from(new Set(dto.branchIds));
      if (dto.branchId === undefined) {
        data.branch =
          newBranchIds.length > 0
            ? { connect: { id: newBranchIds[0] } }
            : { disconnect: true };
      }
      await this.repo.replaceBranches(id, newBranchIds);
    }

    try {
      const updated = await this.repo.update(id, data);
      return toUserResponse(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Email sudah digunakan");
      }
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("User not found");

    const txCount = await this.repo.countTransactions(id);
    if (txCount > 0) {
      throw new BadRequestException(`User memiliki ${txCount} transaksi dan tidak bisa dihapus`);
    }

    await this.repo.delete(id);
    return { success: true };
  }

  async verifyAuthorization(
    userId: string,
    plainPassword: string,
  ): Promise<{ ok: boolean; notSet?: boolean }> {
    const user = await this.repo.findAuthPassword(userId);
    if (!user) return { ok: false };
    if (!user.authorizationPassword) {
      return { ok: false, notSet: true };
    }
    const ok = await bcrypt.compare(plainPassword, user.authorizationPassword);
    return { ok };
  }
}

function toUserResponse(user: RawUser): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    branch: user.branch ? { id: user.branch.id, name: user.branch.name } : null,
    branches: user.branches.map((ub) => ({
      id: ub.branch.id,
      name: ub.branch.name,
    })),
    isActive: user.isActive,
    isMechanic: user.isMechanic,
    createdAt: user.createdAt.toISOString(),
    transactionCount: user._count.transactions,
  };
}
