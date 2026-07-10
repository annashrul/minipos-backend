import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

const SOFT_DELETE_MODELS = new Set<string>(["Product", "User"]);

const READ_ACTIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();

    return new Proxy(this, {
      get(target: PrismaService, prop: string | symbol, receiver: unknown) {
        const value = Reflect.get(target, prop, receiver);
        if (
          typeof prop !== "string" ||
          !SOFT_DELETE_MODELS.has(pascalCase(prop))
        ) {
          return value;
        }
        if (typeof value !== "object" || value === null) return value;

        return new Proxy(value as Record<string, unknown>, {
          get(model: Record<string, unknown>, action: string | symbol) {
            const fn = Reflect.get(model, action);
            if (typeof action !== "string" || typeof fn !== "function")
              return fn;

            if (READ_ACTIONS.has(action)) {
              return (args: Record<string, unknown> = {}) => {
                const where = (args.where ?? {}) as Record<string, unknown>;
                if (where.deletedAt === undefined) {
                  where.deletedAt = null;
                }
                args.where = where;
                return fn.call(model, args);
              };
            }
            return fn.bind(model);
          },
        });
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Retry connect dengan backoff — supaya app tidak crash saat DB sementara
    // tidak bisa dicapai (cold start, DNS belum siap, dsb).
    // App akan tetap boot; request yang datang sebelum DB ready akan gagal
    // dengan 500 (lebih baik daripada container crash → restart loop di Render).
    const maxAttempts = 5;
    const delayMs = [1000, 2000, 4000, 8000, 16000];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log("Prisma connected");
        return;
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt < maxAttempts) {
          const wait = delayMs[attempt - 1] ?? 5000;
          this.logger.error(
            `Prisma failed to connect (attempt ${attempt}/${maxAttempts}): ${msg} — retry in ${wait}ms`,
          );
          await new Promise((r) => setTimeout(r, wait));
        } else {
          this.logger.error(
            `Prisma failed to connect after ${maxAttempts} attempts: ${msg}`,
          );
          // Jangan throw — biarkan app tetap boot agar Render tidak restart loop.
          // DATABASE_URL salah harus diperbaiki di environment variable.
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function pascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
