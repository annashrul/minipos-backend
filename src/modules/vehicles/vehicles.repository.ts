import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const VEHICLE_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  brand: { select: { id: true, name: true } },
  modelRef: { select: { id: true, name: true } },
  _count: { select: { serviceOrders: true } },
} satisfies Prisma.VehicleInclude;

export type RawVehicle = Prisma.VehicleGetPayload<{
  include: typeof VEHICLE_INCLUDE;
}>;

@Injectable()
export class VehiclesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.VehicleWhereInput,
    orderBy: Prisma.VehicleOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawVehicle[]> {
    return this.prisma.vehicle.findMany({
      where,
      include: VEHICLE_INCLUDE,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.VehicleWhereInput): Promise<number> {
    return this.prisma.vehicle.count({ where });
  }

  async findOne(where: Prisma.VehicleWhereInput): Promise<RawVehicle | null> {
    return this.prisma.vehicle.findFirst({
      where,
      include: VEHICLE_INCLUDE,
    });
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<RawVehicle | null> {
    return this.prisma.vehicle.findFirst({
      where: { id, companyId },
      include: VEHICLE_INCLUDE,
    });
  }

  async findExistingPlate(
    companyId: string,
    plateNumber: string,
    excludeId?: string,
  ): Promise<{ id: string } | null> {
    const where: Prisma.VehicleWhereInput = { companyId, plateNumber };
    if (excludeId) where.NOT = { id: excludeId };
    return this.prisma.vehicle.findFirst({
      where,
      select: { id: true },
    });
  }

  async findCustomer(
    companyId: string,
    customerId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
  }

  async create(data: Prisma.VehicleUncheckedCreateInput): Promise<RawVehicle> {
    return this.prisma.vehicle.create({
      data,
      include: VEHICLE_INCLUDE,
    });
  }

  async update(
    id: string,
    data: Prisma.VehicleUpdateInput,
  ): Promise<RawVehicle> {
    return this.prisma.vehicle.update({
      where: { id },
      data,
      include: VEHICLE_INCLUDE,
    });
  }

  async findWithServiceOrderCount(
    companyId: string,
    id: string,
  ): Promise<{ id: string; _count: { serviceOrders: number } } | null> {
    return this.prisma.vehicle.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { serviceOrders: true } } },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.vehicle.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.vehicle.delete({ where: { id } });
  }

  async findExistingById(
    companyId: string,
    id: string,
  ): Promise<{ id: string; plateNumber: string } | null> {
    return this.prisma.vehicle.findFirst({
      where: { id, companyId },
      select: { id: true, plateNumber: true },
    });
  }

  async findServiceOrders(companyId: string, vehicleId: string) {
    return this.prisma.serviceOrder.findMany({
      where: { companyId, vehicleId },
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          select: {
            id: true,
            itemType: true,
            name: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            mechanic: { select: { id: true, name: true } },
          },
        },
        mechanic: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }
}
