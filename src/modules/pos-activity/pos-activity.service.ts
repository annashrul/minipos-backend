import { Injectable } from "@nestjs/common";
import type {
  LogPosActivityDto,
  LogPosActivityResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Lightweight audit log for POS cashier activities (HOLD, RESUME, REPRINT,
 * REDEEM_POINTS, APPLY_VOUCHER, ...). Reuses the existing `AuditLog` table â€”
 * no new Prisma model required. Failures are swallowed so the POS is never
 * blocked by activity logging.
 */
@Injectable()
export class PosActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    userId: string,
    dto: LogPosActivityDto,
  ): Promise<LogPosActivityResponse> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: dto.action,
          entity: dto.entity,
          entityId: dto.entityId ?? null,
          details: dto.details ? JSON.stringify(dto.details) : null,
          branchId: dto.branchId ?? null,
        },
      });
    } catch {
      // Silently fail â€” never block POS.
    }
    return { success: true };
  }
}
