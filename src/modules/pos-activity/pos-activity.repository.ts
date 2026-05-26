import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

@Injectable()
export class PosActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(data: {
    userId: string;
    action: string;
    entity: string;
    entityId: string | null;
    details: string | null;
    branchId: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({ data });
  }
}
