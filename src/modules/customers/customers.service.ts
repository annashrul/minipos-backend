import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateCustomerDto,
  CustomerResponse,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from "./dto/customers.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { CustomersRepository, type RawCustomer } from "./customers.repository";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly prisma: PrismaService,
  ) {}

  async summary(companyId: string) {
    const where = { companyId };
    const [total, grouped, agg] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.groupBy({
        by: ["memberLevel"],
        where,
        _count: { _all: true },
      }),
      this.prisma.customer.aggregate({
        where,
        _sum: { totalSpending: true, points: true },
      }),
    ]);
    const map = new Map(grouped.map((g) => [g.memberLevel, g._count._all]));
    return {
      total,
      regular: map.get("REGULAR") ?? 0,
      silver: map.get("SILVER") ?? 0,
      gold: map.get("GOLD") ?? 0,
      platinum: map.get("PLATINUM") ?? 0,
      totalSpending: agg._sum.totalSpending ?? 0,
      totalPoints: agg._sum.points ?? 0,
    };
  }

  async list(
    companyId: string,
    query: ListCustomersQueryDto,
  ): Promise<PaginatedResponse<CustomerResponse>> {
    const { search, memberLevel, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.CustomerWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { memberCardCode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (memberLevel) where.memberLevel = memberLevel;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.CustomerOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "name":
        case "phone":
        case "email":
        case "memberLevel":
        case "totalSpending":
        case "points":
        case "createdAt":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.CustomerOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toCustomerResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<CustomerResponse> {
    const customer = await this.repo.findOne({ id, companyId });
    if (!customer) throw new NotFoundException("Customer not found");
    return toCustomerResponse(customer);
  }

  async create(
    companyId: string,
    dto: CreateCustomerDto,
  ): Promise<CustomerResponse> {
    try {
      const created = await this.repo.create({
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        memberLevel: dto.memberLevel ?? "REGULAR",
        memberCardCode: dto.memberCardCode ?? null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        companyId,
      });
      return toCustomerResponse(created);
    } catch (err) {
      throwOnDupCustomer(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("Customer not found");

    const data: Prisma.CustomerUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.memberLevel !== undefined) data.memberLevel = dto.memberLevel;
    if (dto.memberCardCode !== undefined) data.memberCardCode = dto.memberCardCode;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }

    try {
      const updated = await this.repo.update(id, data);
      return toCustomerResponse(updated);
    } catch (err) {
      throwOnDupCustomer(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById(companyId, id);
    if (!existing) throw new NotFoundException("Customer not found");
    await this.repo.delete(id);
    return { success: true };
  }

  async bulkDelete(companyId: string, ids: string[]): Promise<{ count: number }> {
    const { count } = await this.prisma.customer.deleteMany({
      where: { id: { in: ids }, companyId },
    });
    return { count };
  }
}

function toCustomerResponse(c: RawCustomer): CustomerResponse {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    memberLevel: c.memberLevel,
    totalSpending: c.totalSpending,
    points: c.points,
    memberCardCode: c.memberCardCode,
    dateOfBirth: c.dateOfBirth ? c.dateOfBirth.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function throwOnDupCustomer(err: unknown): void {
  throwIfUniqueConstraint(err, "Nomor HP atau kode member sudah digunakan");
}
