import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateDebtDto,
  DebtDetailResponse,
  DebtListResponse,
  DebtPaymentResponse,
  DebtResponse,
  DebtSummaryResponse,
  InstallmentConfigDto,
  InstallmentResponse,
  ListDebtsQueryDto,
  PayDebtDto,
} from "./dto/debts.dto";
import { PrismaService } from "../prisma/prisma.service";

const DEBT_SELECT = {
  id: true,
  type: true,
  referenceType: true,
  referenceId: true,
  partyType: true,
  partyId: true,
  partyName: true,
  description: true,
  totalAmount: true,
  paidAmount: true,
  remainingAmount: true,
  status: true,
  dueDate: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  downPayment: true,
  installmentCount: true,
  installmentInterval: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DebtSelect;

const DEBT_DETAIL_SELECT = {
  ...DEBT_SELECT,
  payments: {
    select: {
      id: true,
      debtId: true,
      amount: true,
      method: true,
      notes: true,
      paidBy: true,
      paidAt: true,
    },
    orderBy: { paidAt: "desc" },
  },
  installments: {
    select: {
      id: true,
      debtId: true,
      installmentNo: true,
      amount: true,
      dueDate: true,
      paidAmount: true,
      paidAt: true,
      status: true,
      notes: true,
    },
    orderBy: { installmentNo: "asc" },
  },
} satisfies Prisma.DebtSelect;

type RawDebt = Prisma.DebtGetPayload<{ select: typeof DEBT_SELECT }>;
type RawDebtDetail = Prisma.DebtGetPayload<{
  select: typeof DEBT_DETAIL_SELECT;
}>;

@Injectable()
export class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListDebtsQueryDto,
  ): Promise<DebtListResponse> {
    const where = await this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.debt.findMany({
        where,
        select: DEBT_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.debt.count({ where }),
    ]);

    return {
      debts: rows.map(toDebtResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<DebtDetailResponse> {
    const debt = await this.prisma.debt.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: DEBT_DETAIL_SELECT,
    });
    if (!debt) throw new NotFoundException("Debt not found");
    return toDebtDetailResponse(debt);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateDebtDto,
  ): Promise<DebtDetailResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const created = await this.prisma.$transaction(async (tx) => {
      const dpAmount = dto.installment?.downPayment ?? 0;
      const initialPaid = dpAmount;
      const initialRemaining = Math.max(dto.totalAmount - initialPaid, 0);
      const status =
        initialRemaining <= 0 ? "PAID" : initialPaid > 0 ? "PARTIAL" : "UNPAID";

      const debt = await tx.debt.create({
        data: {
          type: dto.type,
          referenceType: dto.referenceType ?? null,
          referenceId: dto.referenceId ?? null,
          partyType: dto.partyType,
          partyId: dto.partyId ?? null,
          partyName: dto.partyName,
          description: dto.description ?? null,
          totalAmount: dto.totalAmount,
          paidAmount: initialPaid,
          remainingAmount: initialRemaining,
          status,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          branchId: dto.branchId ?? null,
          companyId,
          createdBy: userId,
          downPayment: dpAmount > 0 ? dpAmount : null,
          installmentCount: dto.installment?.installmentCount ?? null,
          installmentInterval: dto.installment?.interval ?? null,
        },
        select: { id: true },
      });

      if (dto.installment) {
        await this.createInstallments(
          tx,
          debt.id,
          dto.totalAmount,
          dto.installment,
        );
        if (dpAmount > 0) {
          await tx.debtPayment.create({
            data: {
              debtId: debt.id,
              amount: dpAmount,
              method: "CASH",
              notes: "Down Payment (DP)",
              paidBy: userId,
            },
          });
        }
      }

      return tx.debt.findUniqueOrThrow({
        where: { id: debt.id },
        select: DEBT_DETAIL_SELECT,
      });
    });

    return toDebtDetailResponse(created);
  }

  async pay(
    companyId: string,
    userId: string,
    id: string,
    dto: PayDebtDto,
  ): Promise<DebtDetailResponse> {
    const debt = await this.prisma.debt.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
      },
    });
    if (!debt) throw new NotFoundException("Debt not found");
    if (debt.status === "PAID") {
      throw new BadRequestException("Hutang sudah lunas");
    }

    const newPaid = debt.paidAmount + dto.amount;
    const newRemaining = Math.max(debt.totalAmount - newPaid, 0);
    if (newPaid > debt.totalAmount) {
      throw new BadRequestException(
        `Jumlah pembayaran melebihi sisa hutang (sisa: ${debt.totalAmount - debt.paidAmount})`,
      );
    }
    const newStatus =
      newRemaining <= 0 ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.debtPayment.create({
        data: {
          debtId: id,
          amount: dto.amount,
          method: dto.method ?? "CASH",
          notes: dto.notes ?? null,
          paidBy: userId,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        },
      });

      await this.applyToInstallments(tx, id, dto.amount);

      await tx.debt.update({
        where: { id },
        data: {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          status: newStatus,
        },
      });

      return tx.debt.findUniqueOrThrow({
        where: { id },
        select: DEBT_DETAIL_SELECT,
      });
    });

    return toDebtDetailResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.debt.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, paidAmount: true },
    });
    if (!existing) throw new NotFoundException("Debt not found");
    if (existing.paidAmount > 0) {
      throw new BadRequestException(
        "Hutang yang sudah memiliki pembayaran tidak bisa dihapus",
      );
    }
    await this.prisma.debt.delete({ where: { id } });
    return { success: true };
  }

  async summary(
    companyId: string,
    query: ListDebtsQueryDto,
  ): Promise<DebtSummaryResponse> {
    const where = await this.buildListWhere(companyId, {
      ...query,
      page: 1,
      perPage: 1,
    });

    const now = new Date();
    const [payable, receivable, overdueAgg] = await Promise.all([
      this.prisma.debt.aggregate({
        where: { ...where, type: "PAYABLE" },
        _sum: { totalAmount: true, remainingAmount: true },
        _count: { _all: true },
      }),
      this.prisma.debt.aggregate({
        where: { ...where, type: "RECEIVABLE" },
        _sum: { totalAmount: true, remainingAmount: true },
        _count: { _all: true },
      }),
      this.prisma.debt.aggregate({
        where: {
          ...where,
          status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
          dueDate: { lt: now },
        },
        _sum: { remainingAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      payable: {
        total: payable._sum.totalAmount ?? 0,
        remaining: payable._sum.remainingAmount ?? 0,
        count: payable._count._all,
      },
      receivable: {
        total: receivable._sum.totalAmount ?? 0,
        remaining: receivable._sum.remainingAmount ?? 0,
        count: receivable._count._all,
      },
      overdue: {
        count: overdueAgg._count._all,
        remaining: overdueAgg._sum.remainingAmount ?? 0,
      },
    };
  }

  async createFromTransaction(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      userId: string;
      transactionId: string;
      invoiceNumber: string;
      branchId: string | null;
      customerId: string;
      partyName: string;
      amount: number;
      installment: InstallmentConfigDto | null;
    },
  ): Promise<string> {
    const dpAmount = params.installment?.downPayment ?? 0;
    const initialPaid = dpAmount;
    const initialRemaining = Math.max(params.amount - initialPaid, 0);
    const status =
      initialRemaining <= 0 ? "PAID" : initialPaid > 0 ? "PARTIAL" : "UNPAID";

    const dueDate = new Date();
    if (params.installment) {
      if (params.installment.interval === "WEEKLY") {
        dueDate.setDate(dueDate.getDate() + params.installment.installmentCount * 7);
      } else {
        dueDate.setMonth(dueDate.getMonth() + params.installment.installmentCount);
      }
    } else {
      dueDate.setDate(dueDate.getDate() + 30);
    }

    const debt = await tx.debt.create({
      data: {
        type: "RECEIVABLE",
        referenceType: "TRANSACTION",
        referenceId: params.transactionId,
        partyType: "CUSTOMER",
        partyId: params.customerId,
        partyName: params.partyName,
        description: `Termin pembayaran invoice ${params.invoiceNumber}`,
        totalAmount: params.amount,
        paidAmount: initialPaid,
        remainingAmount: initialRemaining,
        status,
        dueDate,
        branchId: params.branchId,
        companyId: params.companyId,
        createdBy: params.userId,
        downPayment: dpAmount > 0 ? dpAmount : null,
        installmentCount: params.installment?.installmentCount ?? null,
        installmentInterval: params.installment?.interval ?? null,
      },
      select: { id: true },
    });

    if (params.installment) {
      await this.createInstallments(
        tx,
        debt.id,
        params.amount,
        params.installment,
      );
      if (dpAmount > 0) {
        await tx.debtPayment.create({
          data: {
            debtId: debt.id,
            amount: dpAmount,
            method: "CASH",
            notes: "Down Payment (DP)",
            paidBy: params.userId,
          },
        });
      }
    }

    return debt.id;
  }

  private async buildListWhere(
    companyId: string,
    query: ListDebtsQueryDto,
  ): Promise<Prisma.DebtWhereInput> {
    const { type, status, partyType, partyId, branchId, overdue, from, to } =
      query;
    const where: Prisma.DebtWhereInput = this.tenantWhere(companyId);
    if (type) where.type = type;
    if (status) where.status = status;
    if (partyType) where.partyType = partyType;
    if (partyId) where.partyId = partyId;
    if (branchId) where.branchId = branchId;
    if (overdue) {
      where.status = { in: ["UNPAID", "PARTIAL", "OVERDUE"] };
      where.dueDate = { lt: new Date() };
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.DebtWhereInput {
    return {
      OR: [{ companyId }, { branch: { companyId } }],
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async createInstallments(
    tx: Prisma.TransactionClient,
    debtId: string,
    totalAmount: number,
    config: InstallmentConfigDto,
  ) {
    const dp = config.downPayment ?? 0;
    const remainAfterDp = totalAmount - dp;
    if (remainAfterDp <= 0 || config.installmentCount <= 0) return;
    const perInst = Math.ceil(remainAfterDp / config.installmentCount);
    const now = new Date();
    const rows: Prisma.InstallmentCreateManyInput[] = [];
    for (let i = 0; i < config.installmentCount; i++) {
      const due = new Date(now);
      if (config.interval === "WEEKLY") {
        due.setDate(due.getDate() + (i + 1) * 7);
      } else {
        due.setMonth(due.getMonth() + (i + 1));
      }
      const amount =
        i === config.installmentCount - 1
          ? remainAfterDp - perInst * (config.installmentCount - 1)
          : perInst;
      rows.push({
        debtId,
        installmentNo: i + 1,
        amount,
        dueDate: due,
      });
    }
    await tx.installment.createMany({ data: rows });
  }

  private async applyToInstallments(
    tx: Prisma.TransactionClient,
    debtId: string,
    amount: number,
  ) {
    let remaining = amount;
    const installments = await tx.installment.findMany({
      where: {
        debtId,
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
      },
      orderBy: { installmentNo: "asc" },
    });
    for (const inst of installments) {
      if (remaining <= 0) break;
      const due = inst.amount - inst.paidAmount;
      if (due <= 0) continue;
      const apply = Math.min(remaining, due);
      const newPaid = inst.paidAmount + apply;
      const status =
        newPaid >= inst.amount
          ? "PAID"
          : newPaid > 0
            ? "PARTIAL"
            : "UNPAID";
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          paidAmount: newPaid,
          paidAt: status === "PAID" ? new Date() : inst.paidAt,
          status,
        },
      });
      remaining -= apply;
    }
  }
}

function toDebtResponse(d: RawDebt): DebtResponse {
  return {
    id: d.id,
    type: d.type,
    referenceType: d.referenceType,
    referenceId: d.referenceId,
    partyType: d.partyType,
    partyId: d.partyId,
    partyName: d.partyName,
    description: d.description,
    totalAmount: d.totalAmount,
    paidAmount: d.paidAmount,
    remainingAmount: d.remainingAmount,
    status: d.status,
    dueDate: d.dueDate ? d.dueDate.toISOString() : null,
    branchId: d.branchId,
    branch: d.branch ? { id: d.branch.id, name: d.branch.name } : null,
    downPayment: d.downPayment,
    installmentCount: d.installmentCount,
    installmentInterval: d.installmentInterval,
    createdBy: d.createdBy,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toDebtDetailResponse(d: RawDebtDetail): DebtDetailResponse {
  return {
    ...toDebtResponse(d),
    payments: d.payments.map<DebtPaymentResponse>((p) => ({
      id: p.id,
      debtId: p.debtId,
      amount: p.amount,
      method: p.method,
      notes: p.notes,
      paidBy: p.paidBy,
      paidAt: p.paidAt.toISOString(),
    })),
    installments: d.installments.map<InstallmentResponse>((i) => ({
      id: i.id,
      debtId: i.debtId,
      installmentNo: i.installmentNo,
      amount: i.amount,
      dueDate: i.dueDate.toISOString(),
      paidAmount: i.paidAmount,
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
      status: i.status,
      notes: i.notes,
    })),
  };
}
