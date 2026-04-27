import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import type { Request } from "express";
import type { AuthUser } from "@/contracts";
import { PrismaService } from "../../modules/prisma/prisma.service";

const AUDITED_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    if (!AUDITED_METHODS.has(req.method)) {
      return next.handle();
    }
    if (!req.user) {
      return next.handle();
    }

    const user = req.user;
    const action = this.inferAction(req.method);
    const entity = this.inferEntity(req.path);
    const entityId = this.inferEntityId(req.path);
    const ipAddress = this.inferIp(req);
    const userAgent = req.headers["user-agent"] ?? null;

    return next.handle().pipe(
      tap({
        next: (response) => {
          void this.log({
            userId: user.id,
            branchId: user.branchId,
            action,
            entity,
            entityId: entityId ?? this.extractCreatedId(response),
            details: this.safeDetails(req.body),
            ipAddress,
            userAgent,
          });
        },
      }),
    );
  }

  private async log(params: {
    userId: string;
    branchId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    details: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: params.userId,
          branchId: params.branchId,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          details: params.details,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  private inferAction(method: string): string {
    if (method === "POST") return "CREATE";
    if (method === "PATCH" || method === "PUT") return "UPDATE";
    if (method === "DELETE") return "DELETE";
    return method;
  }

  private inferEntity(path: string): string {
    const segments = path.split("/").filter((s) => s && s !== "api");
    if (segments.length === 0) return "Unknown";
    const first = segments[0] ?? "Unknown";
    return first.charAt(0).toUpperCase() + first.slice(1).replace(/s$/, "");
  }

  private inferEntityId(path: string): string | null {
    const segments = path.split("/").filter((s) => s && s !== "api");
    if (segments.length < 2) return null;
    const candidate = segments[1];
    if (!candidate) return null;
    if (/^[0-9a-f-]{8,}$/i.test(candidate)) return candidate;
    return null;
  }

  private extractCreatedId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null;
    const wrapper = response as { data?: { id?: string } };
    return wrapper.data?.id ?? null;
  }

  private inferIp(req: Request): string | null {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? null;
    if (Array.isArray(forwarded)) return forwarded[0] ?? null;
    const real = req.headers["x-real-ip"];
    if (typeof real === "string") return real;
    return req.ip ?? null;
  }

  private safeDetails(body: unknown): string | null {
    if (body == null) return null;
    try {
      const redacted = this.redactSensitive(body);
      return JSON.stringify(redacted);
    } catch {
      return null;
    }
  }

  private redactSensitive(value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (/password|secret|token/i.test(k)) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = this.redactSensitive(v);
        }
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((v) => this.redactSensitive(v));
    return value;
  }
}
