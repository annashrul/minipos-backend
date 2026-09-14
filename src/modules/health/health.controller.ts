import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RedisService } from "@/modules/redis/redis.service";
import { Public } from "@/modules/auth/public.decorator";
import { EmbeddingClient } from "@/common/embedding/embedding.client";

@ApiTags("Health")
@ApiBearerAuth()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embedding: EmbeddingClient,
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

    let aiServiceOk = false;
    let aiServiceState: "connected" | "disconnected" | "disabled" = "disabled";
    let aiServiceModel: string | null = null;

    if (this.embedding.configured) {
      try {
        const health = await this.embedding.health();
        aiServiceOk = health.status === "ok" && health.dim > 0;
        aiServiceState = aiServiceOk ? "connected" : "disconnected";
        aiServiceModel = health.model ?? null;
      } catch {
        aiServiceState = "disconnected";
      }
    }

    return {
      data: {
        status: aiServiceOk && dbOk ? "ok" : "degraded",
        db: dbOk ? "connected" : "disconnected",
        redis: redisOk,
        aiService: aiServiceState,
        aiServiceModel,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }
}
