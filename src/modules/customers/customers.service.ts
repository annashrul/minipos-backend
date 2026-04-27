import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateCustomerDto,
  CustomerListResponse,
  CustomerResponse,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  memberLevel: true,
  totalSpending: true,
  points: true,
  memberCardCode: true,
  dateOfBirth: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

type RawCustomer = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListCustomersQueryDto,
  ): Promise<CustomerListResponse> {
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
      this.prisma.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      customers: rows.map(toCustomerResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<CustomerResponse> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      select: CUSTOMER_SELECT,
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return toCustomerResponse(customer);
  }

  async create(
    companyId: string,
    dto: CreateCustomerDto,
  ): Promise<CustomerResponse> {
    try {
      const created = await this.prisma.customer.create({
        data: {
          name: dto.name,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          address: dto.address ?? null,
          memberLevel: dto.memberLevel ?? "REGULAR",
          memberCardCode: dto.memberCardCode ?? null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          companyId,
        },
        select: CUSTOMER_SELECT,
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
    const existing = await this.prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
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
      const updated = await this.prisma.customer.update({
        where: { id },
        data,
        select: CUSTOMER_SELECT,
      });
      return toCustomerResponse(updated);
    } catch (err) {
      throwOnDupCustomer(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Customer not found");
    await this.prisma.customer.delete({ where: { id } });
    return { success: true };
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
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Nomor HP atau kode member sudah digunakan");
  }
}
