import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateTaxConfigDto,
  ListTaxConfigsQueryDto,
  TaxConfigListResponse,
  TaxConfigResponse,
  UpdateTaxConfigDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const TAX_SELECT = {
  id: true,
  taxType: true,
  name: true,
  rate: true,
  accountId: true,
  account: { select: { id: true, code: true, name: true } },
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaxConfigSelect;

type RawTax = Prisma.TaxConfigGetPayload<{ select: typeof TAX_SELECT }>;

@Injectable()
export class TaxConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListTaxConfigsQueryDto,
  ): Promise<TaxConfigListResponse> {
    const { search, taxType, isActive, page, perPage } = query;
    const where: Prisma.TaxConfigWhereInput = { companyId };
    if (taxType) where.taxType = taxType;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { taxType: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.taxConfig.findMany({
        where,
        select: TAX_SELECT,
        orderBy: [{ taxType: "asc" }, { name: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.taxConfig.count({ where }),
    ]);

    return {
      taxConfigs: rows.map(toTaxResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<TaxConfigResponse> {
    const tax = await this.prisma.taxConfig.findFirst({
      where: { id, companyId },
      select: TAX_SELECT,
    });
    if (!tax) throw new NotFoundException("Konfigurasi pajak tidak ditemukan");
    return toTaxResponse(tax);
  }

  async create(
    companyId: string,
    dto: CreateTaxConfigDto,
  ): Promise<TaxConfigResponse> {
    await this.ensureAccount(companyId, dto.accountId);

    try {
      const created = await this.prisma.taxConfig.create({
        data: {
          taxType: dto.taxType,
          name: dto.name,
          rate: dto.rate,
          accountId: dto.accountId,
          isActive: dto.isActive ?? true,
          companyId,
        },
        select: TAX_SELECT,
      });
      return toTaxResponse(created);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTaxConfigDto,
  ): Promise<TaxConfigResponse> {
    const existing = await this.prisma.taxConfig.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Konfigurasi pajak tidak ditemukan");
    }

    if (dto.accountId !== undefined) {
      await this.ensureAccount(companyId, dto.accountId);
    }

    const data: Prisma.TaxConfigUpdateInput = {};
    if (dto.taxType !== undefined) data.taxType = dto.taxType;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.rate !== undefined) data.rate = dto.rate;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.accountId !== undefined) {
      data.account = { connect: { id: dto.accountId } };
    }

    try {
      const updated = await this.prisma.taxConfig.update({
        where: { id },
        data,
        select: TAX_SELECT,
      });
      return toTaxResponse(updated);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.taxConfig.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Konfigurasi pajak tidak ditemukan");
    }

    await this.prisma.taxConfig.delete({ where: { id } });
    return { success: true };
  }

  private async ensureAccount(companyId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        "Akun tidak ditemukan atau bukan milik perusahaan ini",
      );
    }
  }
}

function toTaxResponse(t: RawTax): TaxConfigResponse {
  return {
    id: t.id,
    taxType: t.taxType,
    name: t.name,
    rate: t.rate,
    accountId: t.accountId,
    account: t.account
      ? { id: t.account.id, code: t.account.code, name: t.account.name }
      : null,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function throwIfDuplicate(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Tipe pajak sudah digunakan di perusahaan ini");
  }
}
