import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { JournalLineInputDto } from "@/contracts";
import { PrismaService } from "../../../prisma/prisma.service";

@Injectable()
export class JournalsContext {
  constructor(private readonly prisma: PrismaService) {}

  async assertBranch(companyId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  async assertAccountsValid(
    companyId: string,
    lines: JournalLineInputDto[],
  ): Promise<void> {
    const ids = Array.from(new Set(lines.map((l) => l.accountId)));
    if (ids.length === 0) {
      throw new BadRequestException("Daftar akun tidak boleh kosong");
    }
    const accounts = await this.prisma.account.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        category: { companyId },
      },
      select: { id: true },
    });
    if (accounts.length !== ids.length) {
      throw new BadRequestException(
        "Salah satu akun tidak valid atau tidak aktif",
      );
    }
  }

  async resolvePeriod(
    companyId: string,
    date: Date,
  ): Promise<string | null> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { id: true, status: true },
    });
    if (!period) return null;
    if (period.status !== "OPEN") {
      throw new BadRequestException(
        "Periode akuntansi sudah ditutup, jurnal tidak bisa dibuat/diubah",
      );
    }
    return period.id;
  }

  async assertPeriodOpen(companyId: string, date: Date): Promise<void> {
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      select: { status: true },
    });
    if (period && period.status !== "OPEN") {
      throw new BadRequestException(
        "Periode akuntansi sudah ditutup, jurnal tidak bisa di-post",
      );
    }
  }
}
