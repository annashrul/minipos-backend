import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateGiftCardDto,
  GiftCardDetailResponse,
  GiftCardListResponse,
  GiftCardResponse,
  GiftCardTransactionResponse,
  ListGiftCardsQueryDto,
  RedeemGiftCardDto,
  TopupGiftCardDto,
  UpdateGiftCardDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const GIFT_CARD_SELECT = {
  id: true,
  code: true,
  initialBalance: true,
  currentBalance: true,
  status: true,
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  companyId: true,
  expiresAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GiftCardSelect;

const GIFT_CARD_DETAIL_SELECT = {
  ...GIFT_CARD_SELECT,
  transactions: {
    select: {
      id: true,
      giftCardId: true,
      type: true,
      amount: true,
      balanceBefore: true,
      balanceAfter: true,
      reference: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
} satisfies Prisma.GiftCardSelect;

type RawGiftCard = Prisma.GiftCardGetPayload<{
  select: typeof GIFT_CARD_SELECT;
}>;
type RawGiftCardDetail = Prisma.GiftCardGetPayload<{
  select: typeof GIFT_CARD_DETAIL_SELECT;
}>;

const MAX_GENERATE_ATTEMPTS = 5;

@Injectable()
export class GiftCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListGiftCardsQueryDto,
  ): Promise<GiftCardListResponse> {
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

    const where: Prisma.GiftCardWhereInput = this.tenantWhere(companyId);
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
      this.prisma.giftCard.findMany({
        where,
        select: GIFT_CARD_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.giftCard.count({ where }),
    ]);

    return {
      giftCards: rows.map(toGiftCardResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<GiftCardDetailResponse> {
    const giftCard = await this.prisma.giftCard.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: GIFT_CARD_DETAIL_SELECT,
    });
    if (!giftCard) throw new NotFoundException("Gift card not found");
    return toGiftCardDetailResponse(giftCard);
  }

  async findByCode(
    companyId: string,
    code: string,
  ): Promise<GiftCardResponse | null> {
    const giftCard = await this.prisma.giftCard.findFirst({
      where: { code, ...this.tenantWhere(companyId) },
      select: GIFT_CARD_SELECT,
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
      const created = await this.prisma.giftCard.create({
        data: {
          code,
          initialBalance: dto.initialBalance,
          currentBalance: dto.initialBalance,
          status: "ACTIVE",
          customerId: dto.customerId ?? null,
          branchId: dto.branchId ?? null,
          companyId,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdBy: userId,
        },
        select: GIFT_CARD_SELECT,
      });
      return toGiftCardResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode gift card sudah digunakan");
      }
      throw err;
    }
  }

  async topup(
    companyId: string,
    id: string,
    dto: TopupGiftCardDto,
  ): Promise<GiftCardDetailResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const card = await tx.giftCard.findFirst({
        where: { id, ...this.tenantWhere(companyId) },
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const card = await tx.giftCard.findFirst({
        where: { id, ...this.tenantWhere(companyId) },
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
    const card = await this.prisma.giftCard.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
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

    const updated = await this.prisma.giftCard.update({
      where: { id },
      data,
      select: GIFT_CARD_SELECT,
    });
    return toGiftCardResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const card = await this.prisma.giftCard.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, currentBalance: true, initialBalance: true },
    });
    if (!card) throw new NotFoundException("Gift card not found");
    if (card.currentBalance !== card.initialBalance) {
      throw new BadRequestException(
        "Gift card sudah pernah dipakai, tidak bisa dihapus",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.giftCardTransaction.deleteMany({ where: { giftCardId: id } });
      await tx.giftCard.delete({ where: { id } });
    });
    return { success: true };
  }

  private tenantWhere(companyId: string): Prisma.GiftCardWhereInput {
    return {
      OR: [
        { companyId },
        { branch: { companyId } },
        { customer: { companyId } },
      ],
    };
  }

  private async assertCustomer(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async resolveCode(provided?: string): Promise<string> {
    if (provided && provided.length > 0) {
      const exists = await this.prisma.giftCard.findUnique({
        where: { code: provided },
        select: { id: true },
      });
      if (exists) {
        throw new ConflictException("Kode gift card sudah digunakan");
      }
      return provided;
    }
    for (let i = 0; i < MAX_GENERATE_ATTEMPTS; i++) {
      const code = `GC-${randomBytes(6).toString("hex").toUpperCase()}`;
      const exists = await this.prisma.giftCard.findUnique({
        where: { code },
        select: { id: true },
      });
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
