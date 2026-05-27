import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const GIFT_CARD_SELECT = {
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

export const GIFT_CARD_DETAIL_SELECT = {
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

export type RawGiftCard = Prisma.GiftCardGetPayload<{
  select: typeof GIFT_CARD_SELECT;
}>;
export type RawGiftCardDetail = Prisma.GiftCardGetPayload<{
  select: typeof GIFT_CARD_DETAIL_SELECT;
}>;

@Injectable()
export class GiftCardsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.GiftCardWhereInput,
    orderBy: Prisma.GiftCardOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawGiftCard[]> {
    return this.prisma.giftCard.findMany({
      where,
      select: GIFT_CARD_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.GiftCardWhereInput): Promise<number> {
    return this.prisma.giftCard.count({ where });
  }

  async findOne(where: Prisma.GiftCardWhereInput): Promise<RawGiftCard | null> {
    return this.prisma.giftCard.findFirst({
      where,
      select: GIFT_CARD_SELECT,
    });
  }

  async findDetail(
    where: Prisma.GiftCardWhereInput,
  ): Promise<RawGiftCardDetail | null> {
    return this.prisma.giftCard.findFirst({
      where,
      select: GIFT_CARD_DETAIL_SELECT,
    });
  }

  async findMeta(where: Prisma.GiftCardWhereInput) {
    return this.prisma.giftCard.findFirst({
      where,
      select: { id: true, status: true, currentBalance: true, initialBalance: true },
    });
  }

  async findByCode(code: string) {
    return this.prisma.giftCard.findUnique({
      where: { code },
      select: { id: true },
    });
  }

  async findCustomer(companyId: string, customerId: string) {
    return this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
  }

  async findBranch(companyId: string, branchId: string) {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  async create(data: Prisma.GiftCardUncheckedCreateInput): Promise<RawGiftCard> {
    return this.prisma.giftCard.create({
      data,
      select: GIFT_CARD_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.GiftCardUpdateInput,
  ): Promise<RawGiftCard> {
    return this.prisma.giftCard.update({
      where: { id },
      data,
      select: GIFT_CARD_SELECT,
    });
  }

  get tx() {
    return this.prisma;
  }
}
