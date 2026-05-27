import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const BOOKING_SELECT = {
  id: true,
  companyId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  bookingType: true,
  status: true,
  scheduledAt: true,
  durationMin: true,
  notes: true,
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  customerName: true,
  customerPhone: true,
  vehicleId: true,
  vehicle: {
    select: {
      id: true,
      plateNumber: true,
      brand: { select: { name: true } },
      modelRef: { select: { name: true } },
    },
  },
  serviceType: true,
  mechanicId: true,
  mechanic: { select: { id: true, name: true } },
  partySize: true,
  tableId: true,
  table: { select: { id: true, number: true, name: true } },
  reminderSentAt: true,
  serviceOrderId: true,
  cancelReason: true,
  cancelledAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} satisfies Prisma.BookingSelect;

export type RawBooking = Prisma.BookingGetPayload<{
  select: typeof BOOKING_SELECT;
}>;

@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.BookingWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBooking[]> {
    return this.prisma.booking.findMany({
      where,
      select: BOOKING_SELECT,
      orderBy: { scheduledAt: "asc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.BookingWhereInput): Promise<number> {
    return this.prisma.booking.count({ where });
  }

  async groupByStatus(
    where: Prisma.BookingWhereInput,
  ) {
    return this.prisma.booking.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });
  }

  async findOne(
    where: Prisma.BookingWhereInput,
  ): Promise<RawBooking | null> {
    return this.prisma.booking.findFirst({
      where,
      select: BOOKING_SELECT,
    });
  }

  async findStatus(
    companyId: string,
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.booking.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
  }

  async findStatusWithTransaction(
    companyId: string,
    id: string,
  ): Promise<{ id: string; status: string; transactionId: string | null } | null> {
    return this.prisma.booking.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, transactionId: true },
    }) as Promise<{ id: string; status: string; transactionId: string | null } | null>;
  }

  async create(
    data: Prisma.BookingUncheckedCreateInput,
  ): Promise<RawBooking> {
    return this.prisma.booking.create({
      data,
      select: BOOKING_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.BookingUpdateInput,
  ): Promise<RawBooking> {
    return this.prisma.booking.update({
      where: { id },
      data,
      select: BOOKING_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.booking.delete({ where: { id } });
  }

  // --- cross-model validation helpers ---

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
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

  async findVehicle(
    companyId: string,
    vehicleId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId },
      select: { id: true },
    });
  }

  async findCompany(
    companyId: string,
  ): Promise<{ name: string; phone: string | null; address: string | null } | null> {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, address: true },
    });
  }

  // --- promote-to-service-order helpers ---

  async findCustomerByPhone(
    companyId: string,
    phone: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.customer.findFirst({
      where: { companyId, phone },
      select: { id: true },
    });
  }

  async createCustomer(
    data: { companyId: string; name: string; phone: string },
  ): Promise<{ id: string }> {
    return this.prisma.customer.create({
      data,
      select: { id: true },
    });
  }

  async findVehicleByPlate(
    companyId: string,
    plateNumber: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.vehicle.findFirst({
      where: { companyId, plateNumber },
      select: { id: true },
    });
  }

  async createVehicle(
    data: Prisma.VehicleUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return this.prisma.vehicle.create({
      data,
      select: { id: true },
    });
  }

  async createServiceOrder(
    data: Prisma.ServiceOrderUncheckedCreateInput,
  ): Promise<{ id: string; orderNumber: string }> {
    return this.prisma.serviceOrder.create({
      data,
      select: { id: true, orderNumber: true },
    });
  }

  async linkServiceOrder(
    bookingId: string,
    serviceOrderId: string,
  ): Promise<void> {
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { serviceOrderId },
    });
  }
}
