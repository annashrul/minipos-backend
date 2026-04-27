import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

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
