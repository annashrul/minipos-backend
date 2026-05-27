import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import type { AuthUser, JwtPayload } from "@/contracts";
import { AuthRepository, type RawAuthUser } from "./auth.repository";

export type LoginResult = {
  token: string;
  user: AuthUser & { name: string; email: string };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly repo: AuthRepository,
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
    const user = await this.repo.findUserByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.role === "SUPER_ADMIN" && !user.phoneVerified) {
      throw new UnauthorizedException("PHONE_NOT_VERIFIED");
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.buildLoginResult(user);
  }

  /**
   * Auto-login pakai short-lived `loginToken` yang di-issue saat verify OTP
   * berhasil. Token ini disimpan di tabel emailVerificationToken (one-time
   * use, expire 5 menit).
   */
  async loginWithToken(loginToken: string): Promise<LoginResult> {
    if (!loginToken || !loginToken.startsWith("login_")) {
      throw new UnauthorizedException("Invalid login token");
    }

    const record = await this.repo.findVerificationToken(loginToken);
    if (!record) throw new UnauthorizedException("Invalid login token");

    // Consume — hapus segera supaya tidak bisa dipakai ulang.
    await this.repo.deleteVerificationToken(record.id);

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException("Login token expired");
    }

    const user = await this.repo.findUserByEmail(record.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("User not found or inactive");
    }

    return this.buildLoginResult(user);
  }

  async checkAccess(role: string, menuKey: string, actionKey: string): Promise<boolean> {
    const menu = await this.repo.findAccessMenu(menuKey, role, actionKey);
    if (!menu) return true;
    if (!(menu.roleMenus[0]?.allowed ?? false)) return false;
    if (actionKey === "view") return true;
    return menu.actions[0]?.roleActions[0]?.allowed ?? false;
  }

  private buildLoginResult(user: RawAuthUser): LoginResult {
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

  private async writeLoginAudit(userId: string, email: string, branchId: string | null): Promise<void> {
    try {
      await this.repo.createAuditLog(userId, email, branchId);
    } catch {
      // audit is best-effort
    }
  }
}
