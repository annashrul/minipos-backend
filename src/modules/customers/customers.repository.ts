import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const CUSTOMER_SELECT = {
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

export type RawCustomer = Prisma.CustomerGetPayload<{
  select: typeof CUSTOMER_SELECT;
}>;

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.CustomerWhereInput,
    orderBy: Prisma.CustomerOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawCustomer[]> {
    return this.prisma.customer.findMany({
      where,
      select: CUSTOMER_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.CustomerWhereInput): Promise<number> {
    return this.prisma.customer.count({ where });
  }

  async findOne(
    where: Prisma.CustomerWhereInput,
  ): Promise<RawCustomer | null> {
    return this.prisma.customer.findFirst({
      where,
      select: CUSTOMER_SELECT,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
  }

  async create(data: Prisma.CustomerUncheckedCreateInput): Promise<RawCustomer> {
    return this.prisma.customer.create({
      data,
      select: CUSTOMER_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.CustomerUpdateInput,
  ): Promise<RawCustomer> {
    return this.prisma.customer.update({
      where: { id },
      data,
      select: CUSTOMER_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.customer.delete({ where: { id } });
  }
}
