import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthUser } from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { REQUIRE_ACCESS_KEY, RequireAccessMeta } from "./require-access.decorator";

const ACCESS_CACHE_TTL_SECONDS = 60;

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequireAccessMeta | undefined>(
      REQUIRE_ACCESS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const allowed = await this.hasAccess(user.role, meta.menuKey, meta.actionKey);
    if (!allowed) {
      throw new ForbiddenException("Anda tidak memiliki hak akses untuk aksi ini");
    }
    return true;
  }

  private async hasAccess(role: string, menuKey: string, actionKey: string): Promise<boolean> {
    const cacheKey = `access:${role}:${menuKey}:${actionKey}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === "1";

    const allowed = await this.queryAccess(role, menuKey, actionKey);
    await this.redis.set(cacheKey, allowed ? "1" : "0", ACCESS_CACHE_TTL_SECONDS);
    return allowed;
  }

  private async queryAccess(role: string, menuKey: string, actionKey: string): Promise<boolean> {
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
}
