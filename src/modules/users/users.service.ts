import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import type {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UserListResponse,
  UserResponse,
} from "@/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  branches: {
    select: { branch: { select: { id: true, name: true } } },
  },
  isActive: true,
  isMechanic: true,
  createdAt: true,
  _count: { select: { transactions: true } },
} satisfies Prisma.UserSelect;

type RawUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, query: ListUsersQueryDto): Promise<UserListResponse> {
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
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: rows.map(toUserResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException("User not found");
    return toUserResponse(user);
  }

  async create(companyId: string, dto: CreateUserDto): Promise<UserResponse> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Email sudah digunakan");

    const hashed = await bcrypt.hash(dto.password, 10);
    const hashedAuth = dto.authorizationPassword
      ? await bcrypt.hash(dto.authorizationPassword, 10)
      : null;

    // Resolve primary branchId: prefer explicit branchId, fallback ke
    // branchIds[0] kalau ada.
    const primaryBranchId =
      dto.branchId ??
      (dto.branchIds && dto.branchIds.length > 0 ? dto.branchIds[0] : null) ??
      null;
    // Set lengkap branchIds untuk M2M (kalau branchIds tidak dikirim tapi
    // branchId di-set, masukin branchId sebagai single entry).
    const allBranchIds =
      dto.branchIds && dto.branchIds.length > 0
        ? Array.from(new Set(dto.branchIds))
        : primaryBranchId
          ? [primaryBranchId]
          : [];

    const created = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        authorizationPassword: hashedAuth,
        role: dto.role,
        isActive: dto.isActive ?? true,
        isMechanic: dto.isMechanic ?? false,
        emailVerified: true,
        companyId,
        branchId: primaryBranchId,
        ...(allBranchIds.length > 0
          ? {
              branches: {
                create: allBranchIds.map((bid) => ({ branchId: bid })),
              },
            }
          : {}),
      },
      select: USER_SELECT,
    });
    return toUserResponse(created);
  }

  async update(companyId: string, id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
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
      // null = clear (user mau hapus password otorisasi).
      data.authorizationPassword = dto.authorizationPassword
        ? await bcrypt.hash(dto.authorizationPassword, 10)
        : null;
    }

    // Multi-branch update: kalau branchIds dikirim, replace seluruh assignment.
    // Empty array = unassign semua (jadi global). Wrap dalam transaction
    // supaya delete + create atomic.
    if (dto.branchIds !== undefined) {
      const newBranchIds = Array.from(new Set(dto.branchIds));
      // Auto-update primary branchId kalau caller tidak set explicit:
      // - branchIds kosong → branchId null
      // - branchIds ada → branchId = first (kalau dto.branchId tidak dikirim)
      if (dto.branchId === undefined) {
        data.branch =
          newBranchIds.length > 0
            ? { connect: { id: newBranchIds[0] } }
            : { disconnect: true };
      }
      await this.prisma.$transaction([
        this.prisma.userBranch.deleteMany({ where: { userId: id } }),
        ...(newBranchIds.length > 0
          ? [
              this.prisma.userBranch.createMany({
                data: newBranchIds.map((bid) => ({ userId: id, branchId: bid })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data,
        select: USER_SELECT,
      });
      return toUserResponse(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Email sudah digunakan");
      }
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("User not found");

    const txCount = await this.prisma.transaction.count({ where: { userId: id } });
    if (txCount > 0) {
      throw new BadRequestException(`User memiliki ${txCount} transaksi dan tidak bisa dihapus`);
    }

    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Verify password otorisasi user untuk aksi sensitif (void/refund/delete
   * transaksi, dll). Return ok=true kalau cocok. Kalau user belum set
   * authorizationPassword, return ok=false dengan flag `notSet=true` supaya
   * frontend tahu harus arahkan user ke profile untuk set dulu.
   */
  async verifyAuthorization(
    userId: string,
    plainPassword: string,
  ): Promise<{ ok: boolean; notSet?: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { authorizationPassword: true },
    });
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
