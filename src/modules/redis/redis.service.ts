import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis, { type Redis as RedisClient } from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient | null = null;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.warn("REDIS_URL not set — Redis operations will be no-ops");
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.client.on("error", (err) => this.logger.error(`Redis error: ${err.message}`));
    this.client.on("connect", () => this.logger.log("Redis connected"));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  get raw(): RedisClient | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(`get(${key}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, "EX", ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.warn(`set(${key}) failed: ${(err as Error).message}`);
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`del(${key}) failed: ${(err as Error).message}`);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    if (!this.client) return 0;
    try {
      const stream = this.client.scanStream({ match: `${prefix}*`, count: 100 });
      const keys: string[] = [];
      for await (const batch of stream) {
        keys.push(...(batch as string[]));
      }
      if (keys.length === 0) return 0;
      await this.client.del(...keys);
      return keys.length;
    } catch (err) {
      this.logger.warn(`delByPrefix(${prefix}) failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
