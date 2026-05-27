import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();

    return new Proxy(this, {
      get(target: PrismaService, prop: string | symbol, receiver: unknown) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || !SOFT_DELETE_MODELS.has(pascalCase(prop))) {
          return value;
        }
        if (typeof value !== "object" || value === null) return value;

        return new Proxy(value as Record<string, unknown>, {
          get(model: Record<string, unknown>, action: string | symbol) {
            const fn = Reflect.get(model, action);
            if (typeof action !== "string" || typeof fn !== "function") return fn;

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
    try {
      await this.$connect();
      this.logger.log("Prisma connected");
    } catch (err) {
      this.logger.error(`Prisma failed to connect: ${(err as Error).message}`);
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function pascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
