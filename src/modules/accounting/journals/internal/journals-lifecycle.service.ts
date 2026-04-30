import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  JournalDetailResponse,
  VoidJournalDto,
} from "@/contracts";
import { PrismaService } from "../../../prisma/prisma.service";
import { JournalsContext } from "./journals-context.service";
import { JournalsCrudService } from "./journals-crud.service";
import {
  assertBalanced,
  runWithEntryNumber,
  tenantWhere,
} from "./journals.shared";

@Injectable()
export class JournalsLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: JournalsContext,
    private readonly crud: JournalsCrudService,
  ) {}

  async post(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        date: true,
        lines: { select: { debit: true, credit: true } },
      },
    });
    if (!existing) throw new NotFoundException("Journal entry not found");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal berstatus DRAFT yang bisa di-post",
      );
    }
    if (existing.lines.length < 2) {
      throw new BadRequestException("Jurnal minimal memiliki 2 baris");
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of existing.lines) {
      totalDebit += line.debit ?? 0;
      totalCredit += line.credit ?? 0;
    }
    assertBalanced(totalDebit, totalCredit);
    await this.context.assertPeriodOpen(companyId, existing.date);

    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "POSTED",
        approvedBy: userId,
        approvedAt: new Date(),
        totalDebit,
        totalCredit,
        updatedBy: userId,
      },
    });

    return this.crud.findById(companyId, id);
  }

  async voidEntry(
    companyId: string,
    userId: string,
    id: string,
    dto: VoidJournalDto,
  ): Promise<JournalDetailResponse & { reversingEntryNumber?: string }> {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        entryNumber: true,
        description: true,
        branchId: true,
        totalDebit: true,
        totalCredit: true,
        notes: true,
        lines: {
          select: {
            accountId: true,
            description: true,
            debit: true,
            credit: true,
            sortOrder: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException("Journal entry not found");
    if (existing.status === "VOIDED") {
      throw new BadRequestException("Jurnal sudah di-void");
    }
    if (existing.status === "DRAFT") {
      throw new BadRequestException(
        "Jurnal DRAFT tidak perlu void — hapus saja",
      );
    }

    const today = new Date();
    const currentPeriod = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: today },
        endDate: { gte: today },
        status: "OPEN",
      },
      select: { id: true },
    });

    const result = await runWithEntryNumber(today, async (reversingNumber) =>
      this.prisma.$transaction(async (tx) => {
        await tx.journalEntry.update({
          where: { id },
          data: {
            status: "VOIDED",
            rejectionNote: dto.voidReason,
            updatedBy: userId,
            notes: existing.notes
              ? `${existing.notes}\n[VOIDED] ${dto.voidReason}`
              : `[VOIDED] ${dto.voidReason}`,
          },
        });
        await tx.journalEntry.create({
          data: {
            entryNumber: reversingNumber,
            date: today,
            description: `Reversing: ${existing.description} — ${dto.voidReason}`,
            reference: existing.entryNumber,
            referenceType: "MANUAL",
            referenceId: existing.id,
            branchId: existing.branchId,
            periodId: currentPeriod?.id ?? null,
            status: "POSTED",
            totalDebit: existing.totalCredit,
            totalCredit: existing.totalDebit,
            createdBy: userId,
            notes: `Reversing entry for voided journal ${existing.entryNumber}`,
            lines: {
              createMany: {
                data: existing.lines.map((line, idx) => ({
                  accountId: line.accountId,
                  description: `Reversing: ${line.description ?? ""}`,
                  debit: line.credit,
                  credit: line.debit,
                  sortOrder: idx,
                })),
              },
            },
          },
        });
        return reversingNumber;
      }),
    );

    const detail = await this.crud.findById(companyId, id);
    return { ...detail, reversingEntryNumber: result };
  }

  async submitForApproval(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: {
        id: true,
        status: true,
        totalDebit: true,
        totalCredit: true,
        entryNumber: true,
      },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya jurnal DRAFT yang dapat diajukan untuk approval",
      );
    }
    if (Math.abs(entry.totalDebit - entry.totalCredit) > 0.01) {
      throw new BadRequestException(
        "Total debit dan kredit tidak seimbang",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: { status: "PENDING_APPROVAL", updatedBy: userId },
    });
    return this.crud.findById(companyId, id);
  }

  async approve(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<JournalDetailResponse> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Hanya jurnal PENDING_APPROVAL yang dapat disetujui",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
    void userId;
    return this.crud.findById(companyId, id);
  }

  async reject(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<JournalDetailResponse> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException("Alasan penolakan wajib diisi");
    }
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, branch: { companyId } },
      select: { id: true, status: true },
    });
    if (!entry) throw new NotFoundException("Jurnal tidak ditemukan");
    if (entry.status !== "PENDING_APPROVAL") {
      throw new BadRequestException(
        "Hanya jurnal PENDING_APPROVAL yang dapat ditolak",
      );
    }
    await this.prisma.journalEntry.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionNote: reason.trim(),
        updatedBy: userId,
      },
    });
    return this.crud.findById(companyId, id);
  }
}
