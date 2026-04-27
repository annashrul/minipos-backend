import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateStoreCreditDto,
  ListStoreCreditsQueryDto,
  StoreCreditCustomerTotalResponse,
  StoreCreditDetailResponse,
  StoreCreditListResponse,
  StoreCreditResponse,
  StoreCreditUsageResponse,
  UpdateStoreCreditDto,
  UseStoreCreditDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const STORE_CREDIT_SELECT = {
  id: true,
  code: true,
  customerId: true,
  customer: { select: { id: true, name: true, phone: true, companyId: true } },
  balance: true,
  initialAmount: true,
  isActive: true,
  expiryDate: true,
  issuedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StoreCreditSelect;

const STORE_CREDIT_DETAIL_SELECT = {
  ...STORE_CREDIT_SELECT,
  usages: {
    select: {
      id: true,
      storeCreditId: true,
      amount: true,
      transactionId: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
} satisfies Prisma.StoreCreditSelect;

type RawStoreCredit = Prisma.StoreCreditGetPayload<{
  select: typeof STORE_CREDIT_SELECT;
}>;
type RawStoreCreditDetail = Prisma.StoreCreditGetPayload<{
  select: typeof STORE_CREDIT_DETAIL_SELECT;
}>;

const MAX_GENERATE_ATTEMPTS = 5;

@Injectable()
export class StoreCreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListStoreCreditsQueryDto,
  ): Promise<StoreCreditListResponse> {
    const { customerId, isActive, search, page, perPage } = query;

    const where: Prisma.StoreCreditWhereInput = {
      customer: { companyId },
    };
    if (customerId) where.customerId = customerId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.code = { contains: search, mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      this.prisma.storeCredit.findMany({
        where,
        select: STORE_CREDIT_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.storeCredit.count({ where }),
    ]);

    return {
      storeCredits: rows.map(toStoreCreditResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<StoreCreditDetailResponse> {
    const credit = await this.prisma.storeCredit.findFirst({
      where: { id, customer: { companyId } },
      select: STORE_CREDIT_DETAIL_SELECT,
    });
    if (!credit) throw new NotFoundException("Store credit not found");
    return toStoreCreditDetailResponse(credit);
  }

  async customerTotal(
    companyId: string,
    customerId: string,
  ): Promise<StoreCreditCustomerTotalResponse> {
    await this.assertCustomer(companyId, customerId);

    const agg = await this.prisma.storeCredit.aggregate({
      where: { customerId, isActive: true },
      _sum: { balance: true },
      _count: { _all: true },
    });

    return {
      customerId,
      total: agg._sum.balance ?? 0,
      count: agg._count._all,
    };
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateStoreCreditDto,
  ): Promise<StoreCreditResponse> {
    await this.assertCustomer(companyId, dto.customerId);

    const code = await this.resolveCode(dto.code);
    try {
      const created = await this.prisma.storeCredit.create({
        data: {
          customerId: dto.customerId,
          code,
          balance: dto.initialAmount,
          initialAmount: dto.initialAmount,
          isActive: true,
          expiryDate: dto.expiresAt ? new Date(dto.expiresAt) : null,
          issuedBy: userId,
        },
        select: STORE_CREDIT_SELECT,
      });
      return toStoreCreditResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode store credit sudah digunakan");
      }
      throw err;
    }
  }

  async use(
    companyId: string,
    id: string,
    dto: UseStoreCreditDto,
  ): Promise<StoreCreditDetailResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const credit = await tx.storeCredit.findFirst({
        where: { id, customer: { companyId } },
        select: {
          id: true,
          balance: true,
          isActive: true,
          expiryDate: true,
        },
      });
      if (!credit) throw new NotFoundException("Store credit not found");
      if (!credit.isActive) {
        throw new BadRequestException("Store credit tidak aktif");
      }
      if (credit.expiryDate && credit.expiryDate.getTime() < Date.now()) {
        throw new BadRequestException("Store credit sudah kedaluwarsa");
      }
      if (credit.balance < dto.amount) {
        throw new BadRequestException(
          `Saldo store credit tidak mencukupi (saldo: ${credit.balance})`,
        );
      }

      const newBalance = credit.balance - dto.amount;

      await tx.storeCreditUsage.create({
        data: {
          storeCreditId: id,
          amount: dto.amount,
          transactionId: dto.transactionId ?? null,
        },
      });

      await tx.storeCredit.update({
        where: { id },
        data: {
          balance: newBalance,
          isActive: newBalance > 0,
        },
      });

      return tx.storeCredit.findUniqueOrThrow({
        where: { id },
        select: STORE_CREDIT_DETAIL_SELECT,
      });
    });

    return toStoreCreditDetailResponse(updated);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateStoreCreditDto,
  ): Promise<StoreCreditResponse> {
    const credit = await this.prisma.storeCredit.findFirst({
      where: { id, customer: { companyId } },
      select: { id: true },
    });
    if (!credit) throw new NotFoundException("Store credit not found");

    const updated = await this.prisma.storeCredit.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: STORE_CREDIT_SELECT,
    });
    return toStoreCreditResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const credit = await this.prisma.storeCredit.findFirst({
      where: { id, customer: { companyId } },
      select: {
        id: true,
        _count: { select: { usages: true } },
      },
    });
    if (!credit) throw new NotFoundException("Store credit not found");
    if (credit._count.usages > 0) {
      throw new BadRequestException(
        "Store credit yang sudah pernah dipakai tidak bisa dihapus",
      );
    }
    await this.prisma.storeCredit.delete({ where: { id } });
    return { success: true };
  }

  private async assertCustomer(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
  }

  private async resolveCode(provided?: string): Promise<string> {
    if (provided && provided.length > 0) {
      const exists = await this.prisma.storeCredit.findUnique({
        where: { code: provided },
        select: { id: true },
      });
      if (exists) {
        throw new ConflictException("Kode store credit sudah digunakan");
      }
      return provided;
    }
    for (let i = 0; i < MAX_GENERATE_ATTEMPTS; i++) {
      const code = `SC-${randomBytes(6).toString("hex").toUpperCase()}`;
      const exists = await this.prisma.storeCredit.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new ConflictException(
      "Gagal menghasilkan kode store credit unik, silakan coba lagi",
    );
  }
}

function toStoreCreditResponse(s: RawStoreCredit): StoreCreditResponse {
  return {
    id: s.id,
    code: s.code,
    customerId: s.customerId,
    customer: s.customer
      ? { id: s.customer.id, name: s.customer.name, phone: s.customer.phone }
      : null,
    balance: s.balance,
    initialAmount: s.initialAmount,
    source: null,
    isActive: s.isActive,
    expiresAt: s.expiryDate ? s.expiryDate.toISOString() : null,
    issuedBy: s.issuedBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toStoreCreditDetailResponse(
  s: RawStoreCreditDetail,
): StoreCreditDetailResponse {
  return {
    ...toStoreCreditResponse(s),
    usages: s.usages.map<StoreCreditUsageResponse>((u) => ({
      id: u.id,
      storeCreditId: u.storeCreditId,
      amount: u.amount,
      transactionId: u.transactionId,
      notes: u.notes,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}
