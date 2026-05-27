import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { round2 } from "@/common/utils/math";
import type {
  BankReconciliationDetailResponse,
  BankReconciliationItemInputDto,
  BankReconciliationItemResponse,
  BankReconciliationListResponse,
  BankReconciliationResponse,
  CreateBankReconciliationDto,
  ListBankReconciliationsQueryDto,
  SetReconciliationItemsDto,
  ToggleItemMatchDto,
  UpdateBankReconciliationDto,
} from "./dto/bank-reconciliation.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  BankReconciliationRepository,
  type RawRecon,
  type RawReconDetail,
  type RawReconItem,
} from "./bank-reconciliation.repository";

const STATUS_IN_PROGRESS = "IN_PROGRESS";
const STATUS_COMPLETED = "COMPLETED";

@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly repo: BankReconciliationRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    companyId: string,
    query: ListBankReconciliationsQueryDto,
  ): Promise<BankReconciliationListResponse> {
    const where: Prisma.BankReconciliationWhereInput = { companyId };
    if (query.accountId) where.accountId = query.accountId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.statementDate = {};
      if (query.from) where.statementDate.gte = new Date(query.from);
      if (query.to) where.statementDate.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (query.page - 1) * query.perPage, query.perPage),
      this.repo.count(where),
    ]);

    return {
      reconciliations: rows.map(toReconResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<BankReconciliationDetailResponse> {
    const recon = await this.repo.findOne({ id, companyId });
    if (!recon) throw new NotFoundException("Bank reconciliation not found");
    return toReconDetailResponse(recon);
  }

  async create(
    companyId: string,
    dto: CreateBankReconciliationDto,
  ): Promise<BankReconciliationDetailResponse> {
    await this.assertAccount(companyId, dto.accountId);
    const statementDate = new Date(dto.statementDate);
    const bookBalance = await this.computeBookBalance(
      dto.accountId,
      statementDate,
    );

    const created = await this.repo.create({
      accountId: dto.accountId,
      statementDate,
      statementBalance: dto.statementBalance,
      bookBalance,
      status: STATUS_IN_PROGRESS,
      companyId,
    });

    return toReconDetailResponse(created);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateBankReconciliationDto,
  ): Promise<BankReconciliationDetailResponse> {
    const existing = await this.repo.findStatus(id, companyId);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_IN_PROGRESS) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus IN_PROGRESS yang bisa diubah",
      );
    }

    const data: Prisma.BankReconciliationUpdateInput = {};

    if (dto.statementDate !== undefined) {
      const statementDate = new Date(dto.statementDate);
      data.statementDate = statementDate;
      const bookBalance = await this.computeBookBalance(
        existing.accountId,
        statementDate,
      );
      data.bookBalance = bookBalance;
    }
    if (dto.statementBalance !== undefined) {
      data.statementBalance = dto.statementBalance;
    }

    await this.repo.update(id, data);
    return this.findById(companyId, id);
  }

  async setItems(
    companyId: string,
    id: string,
    dto: SetReconciliationItemsDto,
  ): Promise<BankReconciliationDetailResponse> {
    const existing = await this.repo.findStatus(id, companyId);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_IN_PROGRESS) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus IN_PROGRESS yang bisa diubah",
      );
    }

    if (dto.items.length > 0) {
      await this.assertJournalEntriesValid(
        companyId,
        existing.accountId,
        dto.items,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconciliationItem.deleteMany({
        where: { reconciliationId: id },
      });
      if (dto.items.length > 0) {
        await tx.bankReconciliationItem.createMany({
          data: dto.items.map((item) => ({
            reconciliationId: id,
            source: item.source,
            referenceNumber: item.referenceNumber ?? null,
            description: item.description,
            date: new Date(item.date),
            amount: item.amount,
            matchedItemId: item.matchedItemId ?? null,
            matchStatus: item.matchStatus ?? "UNMATCHED",
            journalEntryId: item.journalEntryId ?? null,
          })),
        });
      }
    });

    return this.findById(companyId, id);
  }

  async toggleItemMatch(
    companyId: string,
    id: string,
    itemId: string,
    dto: ToggleItemMatchDto,
  ): Promise<BankReconciliationDetailResponse> {
    const existing = await this.repo.findStatusOnly(id, companyId);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_IN_PROGRESS) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus IN_PROGRESS yang bisa diubah",
      );
    }

    const item = await this.repo.findItem(itemId, id);
    if (!item) throw new NotFoundException("Item not found");

    await this.repo.updateItem(itemId, {
      matchStatus: dto.matchStatus,
      matchedItemId:
        dto.matchedItemId === undefined ? undefined : dto.matchedItemId,
    });

    return this.findById(companyId, id);
  }

  async reconcile(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<BankReconciliationDetailResponse> {
    const [existing, totalItems, unmatchedCount] = await Promise.all([
      this.repo.findForReconcile(id, companyId),
      this.repo.countItems(id),
      this.repo.countUnmatchedItems(id),
    ]);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_IN_PROGRESS) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus IN_PROGRESS yang bisa direkonsiliasi",
      );
    }

    const allMatched = totalItems > 0 && unmatchedCount === 0;
    const balanced =
      Math.abs(existing.statementBalance - existing.bookBalance) <= 0.01;

    if (!allMatched && !balanced) {
      throw new BadRequestException(
        "Selisih saldo belum nol dan masih ada item yang belum di-match",
      );
    }

    await this.repo.update(id, {
      status: STATUS_COMPLETED,
      completedBy: userId,
      completedAt: new Date(),
    });

    return this.findById(companyId, id);
  }

  async reopen(
    companyId: string,
    id: string,
  ): Promise<BankReconciliationDetailResponse> {
    const existing = await this.repo.findStatusOnly(id, companyId);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_COMPLETED) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus COMPLETED yang bisa dibuka kembali",
      );
    }

    await this.repo.update(id, {
      status: STATUS_IN_PROGRESS,
      completedBy: null,
      completedAt: null,
    });

    return this.findById(companyId, id);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findStatusOnly(id, companyId);
    if (!existing) throw new NotFoundException("Bank reconciliation not found");
    if (existing.status !== STATUS_IN_PROGRESS) {
      throw new BadRequestException(
        "Hanya rekonsiliasi berstatus IN_PROGRESS yang bisa dihapus",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconciliationItem.deleteMany({
        where: { reconciliationId: id },
      });
      await tx.bankReconciliation.delete({ where: { id } });
    });
    return { success: true };
  }

  // ===== helpers =====

  private async assertAccount(companyId: string, accountId: string) {
    const account = await this.repo.assertAccount(companyId, accountId);
    if (!account) {
      throw new NotFoundException("Account not found");
    }
  }

  private async assertJournalEntriesValid(
    companyId: string,
    accountId: string,
    items: BankReconciliationItemInputDto[],
  ) {
    const journalIds = Array.from(
      new Set(
        items
          .map((i) => i.journalEntryId)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );
    if (journalIds.length === 0) return;

    const entries = await this.repo.findJournalEntries(journalIds, accountId, companyId);
    if (entries.length !== journalIds.length) {
      throw new BadRequestException(
        "Salah satu jurnal tidak valid untuk akun ini",
      );
    }
  }

  private async computeBookBalance(
    accountId: string,
    asOfDate: Date,
  ): Promise<number> {
    const account = await this.repo.findAccountForBalance(accountId);
    if (!account) return 0;

    const { debitSum, creditSum } = await this.repo.aggregateJournalLines(
      accountId,
      asOfDate,
    );
    const normalSide = account.category?.normalSide ?? "DEBIT";
    const movement =
      normalSide === "DEBIT" ? debitSum - creditSum : creditSum - debitSum;
    return round2((account.openingBalance ?? 0) + movement);
  }
}

function toReconResponse(r: RawRecon): BankReconciliationResponse {
  return {
    id: r.id,
    accountId: r.accountId,
    account: r.account
      ? { id: r.account.id, code: r.account.code, name: r.account.name }
      : null,
    statementDate: r.statementDate.toISOString(),
    statementBalance: r.statementBalance,
    bookBalance: r.bookBalance,
    status: r.status,
    companyId: r.companyId,
    completedBy: r.completedBy,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    itemCount: r._count.items,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toReconItemResponse(
  i: RawReconItem,
): BankReconciliationItemResponse {
  return {
    id: i.id,
    reconciliationId: i.reconciliationId,
    source: i.source,
    referenceNumber: i.referenceNumber,
    description: i.description,
    date: i.date.toISOString(),
    amount: i.amount,
    matchedItemId: i.matchedItemId,
    matchStatus: i.matchStatus,
    journalEntryId: i.journalEntryId,
    createdAt: i.createdAt.toISOString(),
  };
}

function toReconDetailResponse(
  r: RawReconDetail,
): BankReconciliationDetailResponse {
  return {
    ...toReconResponse(r),
    items: r.items.map(toReconItemResponse),
  };
}
