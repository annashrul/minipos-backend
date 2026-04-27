import { ExecutionContext, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import type { AuthUser } from "@/contracts";

export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (!user.companyId) {
      throw new UnauthorizedException("No company context");
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
