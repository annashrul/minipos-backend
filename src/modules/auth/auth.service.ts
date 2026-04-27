import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import type { AuthUser, JwtPayload } from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

export type LoginResult = {
  token: string;
  user: AuthUser & { name: string; email: string };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  signToken(user: AuthUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
      branchId: user.branchId,
    };
    return this.jwt.sign(payload);
  }

  verifyToken(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.role === "SUPER_ADMIN" && !user.emailVerified) {
      throw new UnauthorizedException("Email not verified");
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const authUser: AuthUser = {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
      branchId: user.branchId,
    };
    const token = this.signToken(authUser);

    void this.writeLoginAudit(user.id, user.email, user.branchId);

    return {
      token,
      user: { ...authUser, name: user.name, email: user.email },
    };
  }

  async checkAccess(role: string, menuKey: string, actionKey: string): Promise<boolean> {
    const menu = await this.prisma.appMenu.findFirst({
      where: { key: menuKey, isActive: true },
      include: {
        roleMenus: { where: { role }, select: { allowed: true } },
        actions: {
          where: { key: actionKey, isActive: true },
          include: { roleActions: { where: { role }, select: { allowed: true } } },
        },
      },
    });
    if (!menu) return true;
    if (!(menu.roleMenus[0]?.allowed ?? false)) return false;
    if (actionKey === "view") return true;
    return menu.actions[0]?.roleActions[0]?.allowed ?? false;
  }

  private async writeLoginAudit(userId: string, email: string, branchId: string | null): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          branchId,
          action: "LOGIN",
          entity: "Session",
          details: JSON.stringify({ email }),
        },
      });
    } catch {
      // audit is best-effort
    }
  }
}
