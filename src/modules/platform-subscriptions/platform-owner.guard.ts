import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthUser } from "@/contracts";

@Injectable()
export class PlatformOwnerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (user.role !== "PLATFORM_OWNER") {
      throw new ForbiddenException(
        "Hanya Platform Owner yang dapat mengakses resource ini",
      );
    }
    return true;
  }
}
