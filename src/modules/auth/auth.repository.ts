import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  password: true,
  role: true,
  companyId: true,
  branchId: true,
  isActive: true,
  phoneVerified: true,
} satisfies Prisma.UserSelect;

export type RawAuthUser = Prisma.UserGetPayload<{
  select: typeof AUTH_USER_SELECT;
}>;

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<RawAuthUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: AUTH_USER_SELECT,
    });
  }

  async findVerificationToken(
    token: string,
  ): Promise<{ id: string; email: string; expiresAt: Date } | null> {
    return this.prisma.emailVerificationToken.findUnique({
      where: { token },
      select: { id: true, email: true, expiresAt: true },
    });
  }

  async deleteVerificationToken(id: string): Promise<void> {
    await this.prisma.emailVerificationToken.delete({
      where: { id },
    });
  }

  async findAccessMenu(
    menuKey: string,
    role: string,
    actionKey: string,
  ) {
    return this.prisma.appMenu.findFirst({
      where: { key: menuKey, isActive: true },
      include: {
        roleMenus: { where: { role }, select: { allowed: true } },
        actions: {
          where: { key: actionKey, isActive: true },
          include: {
            roleActions: { where: { role }, select: { allowed: true } },
          },
        },
      },
    });
  }

  async createAuditLog(
    userId: string,
    email: string,
    branchId: string | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        branchId,
        action: "LOGIN",
        entity: "Session",
        details: JSON.stringify({ email }),
      },
    });
  }
}
