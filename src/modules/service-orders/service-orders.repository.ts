import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const SO_SELECT = {
  id: true,
  orderNumber: true,
  companyId: true,
  status: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  vehicleId: true,
  vehicle: {
    select: {
      id: true,
      plateNumber: true,
      type: true,
      brand: { select: { id: true, name: true } },
      modelRef: { select: { id: true, name: true } },
    },
  },
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  mechanicId: true,
  mechanic: { select: { id: true, name: true } },
  complaint: true,
  diagnose: true,
  estimateAmount: true,
  finalAmount: true,
  mileageIn: true,
  mileageOut: true,
  approvedAt: true,
  startedAt: true,
  completedAt: true,
  paidAt: true,
  cancelledAt: true,
  cancelReason: true,
  notes: true,
  transactionId: true,
  items: {
    select: {
      id: true,
      productId: true,
      itemType: true,
      name: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      subtotal: true,
      mechanicId: true,
      mechanic: { select: { id: true, name: true } },
      commissionPct: true,
      commissionAmount: true,
      notes: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ServiceOrderSelect;

export type RawServiceOrder = Prisma.ServiceOrderGetPayload<{
  select: typeof SO_SELECT;
}>;

@Injectable()
export class ServiceOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- core CRUD ---

  async findMany(
    where: Prisma.ServiceOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<RawServiceOrder[]> {
    return this.prisma.serviceOrder.findMany({
      where,
      select: SO_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.ServiceOrderWhereInput): Promise<number> {
    return this.prisma.serviceOrder.count({ where });
  }

  async findOne(
    where: Prisma.ServiceOrderWhereInput,
  ): Promise<RawServiceOrder | null> {
    return this.prisma.serviceOrder.findFirst({
      where,
      select: SO_SELECT,
    });
  }

  async findStatus(
    companyId: string,
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.serviceOrder.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
  }

  async findForFinalize(
    companyId: string,
    id: string,
  ) {
    return this.prisma.serviceOrder.findFirst({
      where: { id, companyId },
      include: { items: true, customer: { select: { id: true } } },
    });
  }

  async findForDelete(
    companyId: string,
    id: string,
  ): Promise<{ id: string; status: string; transactionId: string | null } | null> {
    return this.prisma.serviceOrder.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, transactionId: true },
    });
  }

  async create(
    data: Prisma.ServiceOrderUncheckedCreateInput,
  ): Promise<RawServiceOrder> {
    return this.prisma.serviceOrder.create({
      data,
      select: SO_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.ServiceOrderUpdateInput,
  ): Promise<RawServiceOrder> {
    return this.prisma.serviceOrder.update({
      where: { id },
      data,
      select: SO_SELECT,
    });
  }

  async deleteItems(serviceOrderId: string): Promise<void> {
    await this.prisma.serviceOrderItem.deleteMany({
      where: { serviceOrderId },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.serviceOrder.delete({ where: { id } });
  }

  // --- public queue ---

  async findPublicQueue(
    companyId: string,
    branchId: string,
    recentCutoff: Date,
  ) {
    return this.prisma.serviceOrder.findMany({
      where: {
        companyId,
        branchId,
        OR: [
          {
            status: {
              in: ["ANTRIAN", "DIAGNOSA", "MENUNGGU_APPROVAL", "DIKERJAKAN", "SELESAI"],
            },
          },
          { status: "DIBAYAR", paidAt: { gte: recentCutoff } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        complaint: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        vehicle: {
          select: {
            plateNumber: true,
            type: true,
            brand: { select: { name: true } },
            modelRef: { select: { name: true } },
          },
        },
        customer: { select: { name: true } },
        mechanic: { select: { name: true } },
      },
    });
  }

  // --- cross-model validation helpers ---

  async findVehicle(
    companyId: string,
    vehicleId: string,
  ): Promise<{ id: string; customerId: string | null } | null> {
    return this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId },
      select: { id: true, customerId: true },
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

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  // --- document number helpers ---

  async countOrdersToday(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.serviceOrder.count({
      where: { companyId, createdAt: { gte: start, lt: end } },
    });
  }

  async orderNumberExists(
    companyId: string,
    orderNumber: string,
  ): Promise<boolean> {
    const found = await this.prisma.serviceOrder.findFirst({
      where: { companyId, orderNumber },
      select: { id: true },
    });
    return !!found;
  }

  async findLastInvoiceDisplayNumber(
    companyId: string,
    prefix: string,
  ): Promise<string | null> {
    const last = await this.prisma.transaction.findFirst({
      where: {
        companyId,
        invoiceDisplayNumber: { startsWith: prefix },
      },
      orderBy: { invoiceDisplayNumber: "desc" },
      select: { invoiceDisplayNumber: true },
    });
    return last?.invoiceDisplayNumber ?? null;
  }

  // --- reminder helpers (used by ServiceOrderReminderService) ---

  async findDueForReminder(
    targetStart: Date,
    targetEnd: Date,
    today: Date,
    take: number,
  ) {
    return this.prisma.serviceOrder.findMany({
      where: {
        status: "DIBAYAR",
        nextServiceAt: { gte: targetStart, lt: targetEnd },
        OR: [
          { lastReminderSentAt: null },
          { lastReminderSentAt: { lt: today } },
        ],
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicle: {
          select: {
            plateNumber: true,
            brand: { select: { name: true } },
            modelRef: { select: { name: true } },
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
      take,
    });
  }

  async findWaSenderSession(companyId: string) {
    return this.prisma.whatsappSession.findFirst({
      where: { companyId },
      select: { companyId: true, status: true },
    });
  }

  async markReminderSent(id: string): Promise<void> {
    await this.prisma.serviceOrder.update({
      where: { id },
      data: { lastReminderSentAt: new Date() },
    });
  }
}
