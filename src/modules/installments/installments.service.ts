import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { toDateOnly } from "@/common/utils/date";
import type {
  CreateInstallmentPlanDto,
  InstallmentRecord,
  InstallmentsByDebtResponse,
  PayInstallmentDto,
  PreviewInstallmentEntry,
  PreviewInstallmentScheduleDto,
  UpcomingInstallmentResponse,
  UpdateOverdueInstallmentsResponse,
} from "./dto/installments.dto";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class InstallmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(
    companyId: string,
    userId: string,
    input: CreateInstallmentPlanDto,
  ): Promise<{ success: true }> {
    const debt = await this.prisma.debt.findFirst({
      where: { id: input.debtId, companyId },
    });
    if (!debt) {
      throw new NotFoundException("Data hutang/piutang tidak ditemukan");
    }
    if (debt.status === "PAID") {
      throw new BadRequestException("Hutang/piutang sudah lunas");
    }

    const { downPayment, installmentCount, interval } = input;
    if (downPayment < 0) {
      throw new BadRequestException("DP tidak boleh negatif");
    }
    if (installmentCount < 1 || installmentCount > 60) {
      throw new BadRequestException("Jumlah cicilan harus 1-60");
    }
    if (downPayment >= debt.totalAmount) {
      throw new BadRequestException("DP tidak boleh >= total");
    }

    const remainingAfterDp = debt.totalAmount - downPayment;
    const perInstallment = Math.ceil(remainingAfterDp / installmentCount);
    const today = new Date();

    const installments: {
      installmentNo: number;
      amount: number;
      dueDate: Date;
    }[] = [];
    for (let i = 0; i < installmentCount; i++) {
      const dueDate = new Date(today);
      if (interval === "WEEKLY") {
        dueDate.setDate(dueDate.getDate() + (i + 1) * 7);
      } else {
        dueDate.setMonth(dueDate.getMonth() + (i + 1));
      }
      const amount =
        i === installmentCount - 1
          ? remainingAfterDp - perInstallment * (installmentCount - 1)
          : perInstallment;
      installments.push({ installmentNo: i + 1, amount, dueDate });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.debt.update({
          where: { id: input.debtId },
          data: {
            downPayment,
            installmentCount,
            installmentInterval: interval,
          },
        });

        await tx.installment.deleteMany({
          where: { debtId: input.debtId },
        });

        await tx.installment.createMany({
          data: installments.map((inst) => ({
            debtId: input.debtId,
            installmentNo: inst.installmentNo,
            amount: inst.amount,
            dueDate: inst.dueDate,
          })),
        });

        if (downPayment > 0) {
          await tx.debtPayment.create({
            data: {
              debtId: input.debtId,
              amount: downPayment,
              method: "CASH",
              notes: "Down Payment (DP)",
              paidBy: userId,
            },
          });
          const newPaid = debt.paidAmount + downPayment;
          const newRemaining = debt.totalAmount - newPaid;
          await tx.debt.update({
            where: { id: input.debtId },
            data: {
              paidAmount: newPaid,
              remainingAmount: Math.max(newRemaining, 0),
              status: newRemaining <= 0 ? "PAID" : "PARTIAL",
            },
          });
        }
      });

      return { success: true };
    } catch {
      throw new BadRequestException("Gagal membuat jadwal cicilan");
    }
  }

  async pay(
    companyId: string,
    userId: string,
    installmentId: string,
    body: PayInstallmentDto,
  ): Promise<{ success: true }> {
    const { amount, method = "CASH", notes } = body;
    if (amount <= 0) {
      throw new BadRequestException("Jumlah harus lebih dari 0");
    }

    const installment = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: {
        debt: {
          select: {
            id: true,
            companyId: true,
            totalAmount: true,
            paidAmount: true,
            remainingAmount: true,
          },
        },
      },
    });
    if (!installment || installment.debt.companyId !== companyId) {
      throw new NotFoundException("Cicilan tidak ditemukan");
    }
    if (installment.status === "PAID") {
      throw new BadRequestException("Cicilan ini sudah lunas");
    }

    const maxPayable = installment.amount - installment.paidAmount;
    if (amount > maxPayable) {
      throw new BadRequestException(
        `Maksimal pembayaran cicilan ini: ${maxPayable}`,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const newInstPaid = installment.paidAmount + amount;
        const instStatus =
          newInstPaid >= installment.amount ? "PAID" : "PARTIAL";

        await tx.installment.update({
          where: { id: installmentId },
          data: {
            paidAmount: newInstPaid,
            status: instStatus,
            ...(instStatus === "PAID" ? { paidAt: new Date() } : {}),
          },
        });

        await tx.debtPayment.create({
          data: {
            debtId: installment.debtId,
            amount,
            method,
            notes: notes || `Cicilan ke-${installment.installmentNo}`,
            paidBy: userId,
          },
        });

        const newDebtPaid = installment.debt.paidAmount + amount;
        const newDebtRemaining = installment.debt.totalAmount - newDebtPaid;
        await tx.debt.update({
          where: { id: installment.debtId },
          data: {
            paidAmount: newDebtPaid,
            remainingAmount: Math.max(newDebtRemaining, 0),
            status: newDebtRemaining <= 0 ? "PAID" : "PARTIAL",
          },
        });
      });

      return { success: true };
    } catch {
      throw new BadRequestException("Gagal memproses pembayaran cicilan");
    }
  }

  async getByDebt(
    companyId: string,
    debtId: string,
  ): Promise<InstallmentsByDebtResponse | null> {
    const debt = await this.prisma.debt.findFirst({
      where: { id: debtId, companyId },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        status: true,
        downPayment: true,
        installmentCount: true,
        installmentInterval: true,
        partyName: true,
        description: true,
        dueDate: true,
        installments: { orderBy: { installmentNo: "asc" } },
        payments: {
          orderBy: { paidAt: "desc" },
          select: {
            id: true,
            amount: true,
            method: true,
            notes: true,
            paidAt: true,
          },
        },
      },
    });
    if (!debt) return null;

    return {
      id: debt.id,
      totalAmount: debt.totalAmount,
      paidAmount: debt.paidAmount,
      remainingAmount: debt.remainingAmount,
      status: debt.status,
      downPayment: debt.downPayment,
      installmentCount: debt.installmentCount,
      installmentInterval: debt.installmentInterval,
      partyName: debt.partyName,
      description: debt.description,
      dueDate: debt.dueDate ? debt.dueDate.toISOString() : null,
      installments: debt.installments.map<InstallmentRecord>((i) => ({
        id: i.id,
        debtId: i.debtId,
        installmentNo: i.installmentNo,
        amount: i.amount,
        dueDate: i.dueDate.toISOString(),
        paidAmount: i.paidAmount,
        paidAt: i.paidAt ? i.paidAt.toISOString() : null,
        status: i.status,
        notes: i.notes,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
      payments: debt.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        notes: p.notes,
        paidAt: p.paidAt.toISOString(),
      })),
    };
  }

  async getUpcomingDue(
    companyId: string,
    daysAhead: number,
  ): Promise<UpcomingInstallmentResponse[]> {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + daysAhead);

    const installments = await this.prisma.installment.findMany({
      where: {
        status: { in: ["UNPAID", "PARTIAL"] },
        dueDate: { lte: future },
        debt: { companyId },
      },
      include: {
        debt: {
          select: {
            partyName: true,
            description: true,
            type: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 50,
    });

    return installments.map((inst) => ({
      id: inst.id,
      debtId: inst.debtId,
      installmentNo: inst.installmentNo,
      amount: inst.amount,
      dueDate: inst.dueDate.toISOString(),
      paidAmount: inst.paidAmount,
      paidAt: inst.paidAt ? inst.paidAt.toISOString() : null,
      status: inst.status,
      notes: inst.notes,
      createdAt: inst.createdAt.toISOString(),
      updatedAt: inst.updatedAt.toISOString(),
      isOverdue: new Date(inst.dueDate) < now,
      daysUntilDue: Math.ceil(
        (new Date(inst.dueDate).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
      debt: {
        partyName: inst.debt.partyName,
        description: inst.debt.description,
        type: inst.debt.type,
        referenceType: inst.debt.referenceType,
        referenceId: inst.debt.referenceId,
      },
    }));
  }

  async updateOverdue(
    companyId: string,
  ): Promise<UpdateOverdueInstallmentsResponse> {
    const now = new Date();
    const result = await this.prisma.installment.updateMany({
      where: {
        status: "UNPAID",
        dueDate: { lt: now },
        debt: { companyId },
      },
      data: { status: "OVERDUE" },
    });
    return { updated: result.count };
  }

  previewSchedule(
    body: PreviewInstallmentScheduleDto,
  ): PreviewInstallmentEntry[] {
    const { totalAmount, downPayment, installmentCount, interval } = body;
    const remainingAfterDp = totalAmount - downPayment;
    if (remainingAfterDp <= 0 || installmentCount <= 0) return [];

    const perInstallment = Math.ceil(remainingAfterDp / installmentCount);
    const today = new Date();
    const schedule: PreviewInstallmentEntry[] = [];

    for (let i = 0; i < installmentCount; i++) {
      const dueDate = new Date(today);
      if (interval === "WEEKLY") {
        dueDate.setDate(dueDate.getDate() + (i + 1) * 7);
      } else {
        dueDate.setMonth(dueDate.getMonth() + (i + 1));
      }
      const amount =
        i === installmentCount - 1
          ? remainingAfterDp - perInstallment * (installmentCount - 1)
          : perInstallment;
      schedule.push({
        no: i + 1,
        amount,
        dueDate: toDateOnly(dueDate),
      });
    }

    return schedule;
  }
}
