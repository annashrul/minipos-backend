import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const SCHEDULE_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true, email: true, role: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  date: true,
  shiftStart: true,
  shiftEnd: true,
  shiftLabel: true,
  status: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeScheduleSelect;

export type RawSchedule = Prisma.EmployeeScheduleGetPayload<{
  select: typeof SCHEDULE_SELECT;
}>;

@Injectable()
export class EmployeeSchedulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.EmployeeScheduleWhereInput,
    orderBy: Prisma.EmployeeScheduleOrderByWithRelationInput | Prisma.EmployeeScheduleOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<RawSchedule[]> {
    return this.prisma.employeeSchedule.findMany({
      where,
      select: SCHEDULE_SELECT,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.EmployeeScheduleWhereInput): Promise<number> {
    return this.prisma.employeeSchedule.count({ where });
  }

  async findOne(
    where: Prisma.EmployeeScheduleWhereInput,
  ): Promise<RawSchedule | null> {
    return this.prisma.employeeSchedule.findFirst({
      where,
      select: SCHEDULE_SELECT,
    });
  }

  async findManyByWhere(
    where: Prisma.EmployeeScheduleWhereInput,
    orderBy: Prisma.EmployeeScheduleOrderByWithRelationInput | Prisma.EmployeeScheduleOrderByWithRelationInput[],
  ): Promise<RawSchedule[]> {
    return this.prisma.employeeSchedule.findMany({
      where,
      select: SCHEDULE_SELECT,
      orderBy,
    });
  }

  async findExistence(
    where: Prisma.EmployeeScheduleWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.employeeSchedule.findFirst({
      where,
      select: { id: true },
    });
  }

  async create(
    data: Prisma.EmployeeScheduleUncheckedCreateInput,
  ): Promise<RawSchedule> {
    return this.prisma.employeeSchedule.create({
      data,
      select: SCHEDULE_SELECT,
    });
  }

  async createMany(
    data: Prisma.EmployeeScheduleCreateManyInput[],
  ): Promise<number> {
    const result = await this.prisma.employeeSchedule.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async update(
    id: string,
    data: Prisma.EmployeeScheduleUpdateInput,
  ): Promise<RawSchedule> {
    return this.prisma.employeeSchedule.update({
      where: { id },
      data,
      select: SCHEDULE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.employeeSchedule.delete({ where: { id } });
  }

  async countUsers(where: Prisma.UserWhereInput): Promise<number> {
    return this.prisma.user.count({ where });
  }

  async countBranches(where: Prisma.BranchWhereInput): Promise<number> {
    return this.prisma.branch.count({ where });
  }

  async findUser(
    where: Prisma.UserWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where,
      select: { id: true },
    });
  }

  async findBranch(
    where: Prisma.BranchWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where,
      select: { id: true },
    });
  }
}
