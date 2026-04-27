import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { AuthUser } from "@/contracts";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return req.user;
  },
);
