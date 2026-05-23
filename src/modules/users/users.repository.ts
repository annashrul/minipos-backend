import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const USER_SELECT = {
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

export type RawUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.UserWhereInput,
    skip: number,
    take: number,
  ): Promise<RawUser[]> {
    return this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.UserWhereInput): Promise<number> {
    return this.prisma.user.count({ where });
  }

  async findOne(where: Prisma.UserWhereInput): Promise<RawUser | null> {
    return this.prisma.user.findFirst({
      where,
      select: USER_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
  }

  async findByEmail(email: string): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
  }

  async findAuthPassword(
    userId: string,
  ): Promise<{ authorizationPassword: string | null } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { authorizationPassword: true },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<RawUser> {
    return this.prisma.user.create({
      data,
      select: USER_SELECT,
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<RawUser> {
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  async countTransactions(userId: string): Promise<number> {
    return this.prisma.transaction.count({ where: { userId } });
  }

  async replaceBranches(userId: string, branchIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.userBranch.deleteMany({ where: { userId } }),
      ...(branchIds.length > 0
        ? [
            this.prisma.userBranch.createMany({
              data: branchIds.map((bid) => ({ userId, branchId: bid })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }
}
