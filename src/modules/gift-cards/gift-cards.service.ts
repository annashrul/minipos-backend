import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateGiftCardDto,
  GiftCardDetailResponse,
  GiftCardResponse,
  GiftCardTransactionResponse,
  ListGiftCardsQueryDto,
  RedeemGiftCardDto,
  TopupGiftCardDto,
  UpdateGiftCardDto,
} from "./dto/gift-cards.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { tenantWhere } from "@/common/utils/tenant";
import {
  GiftCardsRepository,
  GIFT_CARD_DETAIL_SELECT,
  type RawGiftCard,
  type RawGiftCardDetail,
} from "./gift-cards.repository";

const MAX_GENERATE_ATTEMPTS = 5;

@Injectable()
export class GiftCardsService {
  constructor(private readonly repo: GiftCardsRepository) {}

  async list(
    companyId: string,
    query: ListGiftCardsQueryDto,
  ): Promise<PaginatedResponse<GiftCardResponse>> {
    const {
      customerId,
      branchId,
      isActive,
      search,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;

    const where: Prisma.GiftCardWhereInput = tenantWhere(companyId, "direct", "branch", "customer");
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (isActive !== undefined) {
      where.status = isActive ? "ACTIVE" : { not: "ACTIVE" };
    }
    if (search) {
      where.code = { contains: search, mode: "insensitive" };
    }

    const dir: "asc" | "desc" = sortDir ?? "desc";
    let orderBy: Prisma.GiftCardOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "code":
        case "initialBalance":
        case "currentBalance":
        case "status":
        case "expiresAt":
        case "createdAt":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.GiftCardOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toGiftCardResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<GiftCardDetailResponse> {
    const giftCard = await this.repo.findDetail({
      id,
      ...tenantWhere(companyId, "direct", "branch", "customer"),
    });
    if (!giftCard) throw new NotFoundException("Gift card not found");
    return toGiftCardDetailResponse(giftCard);
  }

  async findByCode(
    companyId: string,
    code: string,
  ): Promise<GiftCardResponse | null> {
    const giftCard = await this.repo.findOne({
      code,
      ...tenantWhere(companyId, "direct", "branch", "customer"),
    });
    return giftCard ? toGiftCardResponse(giftCard) : null;
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateGiftCardDto,
  ): Promise<GiftCardResponse> {
    if (dto.customerId) await this.assertCustomer(companyId, dto.customerId);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const code = await this.resolveCode(dto.code);
    try {
      const created = await this.repo.create({
        code,
        initialBalance: dto.initialBalance,
        currentBalance: dto.initialBalance,
        status: "ACTIVE",
        customerId: dto.customerId ?? null,
        branchId: dto.branchId ?? null,
        companyId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy: userId,
      });
      return toGiftCardResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Kode gift card sudah digunakan");
    }
  }

  async topup(
    companyId: string,
    id: string,
    dto: TopupGiftCardDto,
  ): Promise<GiftCardDetailResponse> {
    const updated = await this.repo.tx.$transaction(async (tx) => {
      const card = await tx.giftCard.findFirst({
        where: { id, ...tenantWhere(companyId, "direct", "branch", "customer") },
        select: { id: true, currentBalance: true, status: true },
      });
      if (!card) throw new NotFoundException("Gift card not found");
      if (card.status !== "ACTIVE") {
        throw new BadRequestException(
          "Gift card tidak aktif, tidak bisa top-up",
        );
      }

      const before = card.currentBalance;
      const after = before + dto.amount;

      await tx.giftCard.update({
        where: { id },
        data: { currentBalance: after },
      });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: id,
          type: "TOPUP",
          amount: dto.amount,
          balanceBefore: before,
          balanceAfter: after,
          reference: dto.reference ?? null,
        },
      });

      return tx.giftCard.findUniqueOrThrow({
        where: { id },
        select: GIFT_CARD_DETAIL_SELECT,
      });
    });

    return toGiftCardDetailResponse(updated);
  }

  async redeem(
    companyId: string,
    id: string,
    dto: RedeemGiftCardDto,
  ): Promise<GiftCardDetailResponse> {
    const updated = await this.repo.tx.$transaction(async (tx) => {
      const card = await tx.giftCard.findFirst({
        where: { id, ...tenantWhere(companyId, "direct", "branch", "customer") },
        select: {
          id: true,
          currentBalance: true,
          status: true,
          expiresAt: true,
        },
      });
      if (!card) throw new NotFoundException("Gift card not found");
      if (card.status !== "ACTIVE") {
        throw new BadRequestException("Gift card tidak aktif");
      }
      if (card.expiresAt && card.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException("Gift card sudah kedaluwarsa");
      }
      if (card.currentBalance < dto.amount) {
        throw new BadRequestException(
          `Saldo gift card tidak mencukupi (saldo: ${card.currentBalance})`,
        );
      }

      const before = card.currentBalance;
      const after = before - dto.amount;

      await tx.giftCard.update({
        where: { id },
        data: {
          currentBalance: after,
          ...(after <= 0 ? { status: "USED" } : {}),
        },
      });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: id,
          type: "REDEEM",
          amount: dto.amount,
          balanceBefore: before,
          balanceAfter: after,
          reference: dto.reference ?? dto.transactionId ?? null,
        },
      });

      return tx.giftCard.findUniqueOrThrow({
        where: { id },
        select: GIFT_CARD_DETAIL_SELECT,
      });
    });

    return toGiftCardDetailResponse(updated);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateGiftCardDto,
  ): Promise<GiftCardResponse> {
    const card = await this.repo.findMeta({
      id,
      ...tenantWhere(companyId, "direct", "branch", "customer"),
    });
    if (!card) throw new NotFoundException("Gift card not found");

    const data: Prisma.GiftCardUpdateInput = {};
    if (dto.isActive !== undefined) {
      data.status = dto.isActive
        ? "ACTIVE"
        : card.status === "ACTIVE"
          ? "DISABLED"
          : card.status;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    const updated = await this.repo.update(id, data);
    return toGiftCardResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const card = await this.repo.findMeta({
      id,
      ...tenantWhere(companyId, "direct", "branch", "customer"),
    });
    if (!card) throw new NotFoundException("Gift card not found");
    if (card.currentBalance !== card.initialBalance) {
      throw new BadRequestException(
        "Gift card sudah pernah dipakai, tidak bisa dihapus",
      );
    }
    await this.repo.tx.$transaction(async (tx) => {
      await tx.giftCardTransaction.deleteMany({ where: { giftCardId: id } });
      await tx.giftCard.delete({ where: { id } });
    });
    return { success: true };
  }

  async stats(companyId: string, branchId?: string) {
    const where: Prisma.GiftCardWhereInput = tenantWhere(companyId, "direct", "branch", "customer");
    if (branchId) where.branchId = branchId;

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [total, active, activeAgg, allAgg, expiringSoon] = await Promise.all([
      this.repo.count(where),
      this.repo.count({ ...where, status: "ACTIVE" }),
      this.repo.tx.giftCard.aggregate({
        where: { ...where, status: "ACTIVE" },
        _sum: { currentBalance: true },
      }),
      this.repo.tx.giftCard.aggregate({
        where,
        _sum: { initialBalance: true, currentBalance: true },
      }),
      this.repo.count({
        ...where,
        status: "ACTIVE",
        expiresAt: { gte: now, lte: thirtyDaysFromNow },
      }),
    ]);

    const totalBalance = allAgg._sum.initialBalance ?? 0;
    const currentBalance = allAgg._sum.currentBalance ?? 0;

    return {
      total,
      totalActiveCards: active,
      totalBalanceOutstanding: activeAgg._sum.currentBalance ?? 0,
      totalRedeemed: totalBalance - currentBalance,
      expiringSoon,
    };
  }

  private async assertCustomer(companyId: string, customerId: string) {
    const customer = await this.repo.findCustomer(companyId, customerId);
    if (!customer) throw new NotFoundException("Customer not found");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.repo.findBranch(companyId, branchId);
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async resolveCode(provided?: string): Promise<string> {
    if (provided && provided.length > 0) {
      const exists = await this.repo.findByCode(provided);
      if (exists) {
        throw new ConflictException("Kode gift card sudah digunakan");
      }
      return provided;
    }
    for (let i = 0; i < MAX_GENERATE_ATTEMPTS; i++) {
      const code = `GC-${randomBytes(6).toString("hex").toUpperCase()}`;
      const exists = await this.repo.findByCode(code);
      if (!exists) return code;
    }
    throw new ConflictException(
      "Gagal menghasilkan kode gift card unik, silakan coba lagi",
    );
  }
}

function toGiftCardResponse(g: RawGiftCard): GiftCardResponse {
  return {
    id: g.id,
    code: g.code,
    initialBalance: g.initialBalance,
    balance: g.currentBalance,
    status: g.status,
    isActive: g.status === "ACTIVE",
    customerId: g.customerId,
    customer: g.customer
      ? { id: g.customer.id, name: g.customer.name, phone: g.customer.phone }
      : null,
    branchId: g.branchId,
    branch: g.branch ? { id: g.branch.id, name: g.branch.name } : null,
    companyId: g.companyId,
    expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
    createdBy: g.createdBy,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function toGiftCardDetailResponse(
  g: RawGiftCardDetail,
): GiftCardDetailResponse {
  return {
    ...toGiftCardResponse(g),
    transactions: g.transactions.map<GiftCardTransactionResponse>((t) => ({
      id: t.id,
      giftCardId: t.giftCardId,
      type: t.type,
      amount: t.amount,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      reference: t.reference,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
