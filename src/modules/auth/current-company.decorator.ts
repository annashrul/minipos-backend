import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import type { AuthUser } from "@/contracts";

export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    // 401 = belum auth (token invalid/missing)
    if (!user) throw new UnauthorizedException();
    // 403 = sudah auth tapi role-nya tidak punya company context (mis.
    // PLATFORM_OWNER yang akses endpoint tenant-scoped). Penting BUKAN 401:
    // frontend treat 401 sebagai token-expired → force logout. 403 di-catch
    // diam-diam oleh komponen yang error-tolerant.
    if (!user.companyId) {
      throw new ForbiddenException("No company context");
    }
    return user.companyId;
  },
);

export const CurrentCompanyOrNull = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return req.user?.companyId ?? null;
  },
);

/**
 * Khusus untuk endpoint WA yang bisa diakses PLATFORM_OWNER. PLATFORM_OWNER
 * tidak punya companyId (null), jadi route ke session pengirim platform —
 * yaitu companyId = "default-company-id" di tabel whatsapp_sessions. User
 * lain pakai companyId mereka sendiri seperti biasa.
 */
export const PLATFORM_WA_SENDER_ID = "default-company-id";

export const WhatsappCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (user.role === "PLATFORM_OWNER") return PLATFORM_WA_SENDER_ID;
    if (!user.companyId) {
      throw new ForbiddenException("No company context");
    }
    return user.companyId;
  },
);
