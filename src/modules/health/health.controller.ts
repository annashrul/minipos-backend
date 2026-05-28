import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RedisService } from "@/modules/redis/redis.service";
import { Public } from "@/modules/auth/public.decorator";

@ApiTags("Health")
@ApiBearerAuth()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Health check" })
  async check() {
    let dbOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    let redisOk: "connected" | "disconnected" | "disabled" = "disabled";
    if (this.redis.enabled && this.redis.raw) {
      try {
        const pong = await this.redis.raw.ping();
        redisOk = pong === "PONG" ? "connected" : "disconnected";
      } catch {
        redisOk = "disconnected";
      }
    }

    return {
      data: {
        status: "ok",
        db: dbOk ? "connected" : "disconnected",
        redis: redisOk,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }
}
