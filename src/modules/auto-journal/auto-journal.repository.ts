import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

const TRANSACTION_SELECT = {
  id: true,
  invoiceNumber: true,
  invoiceDisplayNumber: true,
  paymentMethod: true,
  grandTotal: true,
  changeAmount: true,
  taxAmount: true,
  items: {
    include: { product: { select: { purchasePrice: true } } },
  },
  payments: true,
} satisfies Prisma.TransactionSelect;

const PURCHASE_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  totalAmount: true,
  paidAmount: true,
  supplier: { select: { name: true } },
} satisfies Prisma.PurchaseOrderSelect;

const RETURN_EXCHANGE_SELECT = {
  id: true,
  returnNumber: true,
  totalRefund: true,
  refundMethod: true,
  items: {
    include: { product: { select: { purchasePrice: true } } },
  },
} satisfies Prisma.ReturnExchangeSelect;

const DEBT_PAYMENT_SELECT = {
  id: true,
  amount: true,
  debtId: true,
  debt: {
    select: {
      id: true,
      type: true,
      partyName: true,
      description: true,
    },
  },
} satisfies Prisma.DebtPaymentSelect;

const EXPENSE_SELECT = {
  id: true,
  category: true,
  description: true,
  amount: true,
} satisfies Prisma.ExpenseSelect;

export type RawTransaction = Prisma.TransactionGetPayload<{
  select: typeof TRANSACTION_SELECT;
}>;
export type RawPurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  select: typeof PURCHASE_ORDER_SELECT;
}>;
export type RawReturnExchange = Prisma.ReturnExchangeGetPayload<{
  select: typeof RETURN_EXCHANGE_SELECT;
}>;
export type RawDebtPayment = Prisma.DebtPaymentGetPayload<{
  select: typeof DEBT_PAYMENT_SELECT;
}>;
export type RawExpense = Prisma.ExpenseGetPayload<{
  select: typeof EXPENSE_SELECT;
}>;

@Injectable()
export class AutoJournalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTransaction(id: string): Promise<RawTransaction | null> {
    return this.prisma.transaction.findUnique({
      where: { id },
      select: TRANSACTION_SELECT,
    });
  }

  async findPurchaseOrder(id: string): Promise<RawPurchaseOrder | null> {
    return this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: PURCHASE_ORDER_SELECT,
    });
  }

  async findReturnExchange(id: string): Promise<RawReturnExchange | null> {
    return this.prisma.returnExchange.findUnique({
      where: { id },
      select: RETURN_EXCHANGE_SELECT,
    });
  }

  async findDebtPayment(id: string): Promise<RawDebtPayment | null> {
    return this.prisma.debtPayment.findUnique({
      where: { id },
      select: DEBT_PAYMENT_SELECT,
    });
  }

  async findExpense(id: string): Promise<RawExpense | null> {
    return this.prisma.expense.findUnique({
      where: { id },
      select: EXPENSE_SELECT,
    });
  }

  async findSystemAccounts(
    codes: string[],
    companyId: string,
  ): Promise<{ id: string; code: string }[]> {
    return this.prisma.account.findMany({
      where: { code: { in: codes }, category: { companyId } },
      select: { id: true, code: true },
    });
  }

  async findOpenPeriod(
    companyId: string,
    date: Date,
  ): Promise<{ id: string } | null> {
    return this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: date },
        endDate: { gte: date },
        status: "OPEN",
      },
      select: { id: true },
    });
  }

  async createJournalEntry(
    data: Prisma.JournalEntryUncheckedCreateInput & {
      lines: {
        createMany: {
          data: Prisma.JournalEntryLineUncheckedCreateWithoutJournalInput[];
        };
      };
    },
  ): Promise<{ id: string; entryNumber: string }> {
    return this.prisma.journalEntry.create({
      data,
      select: { id: true, entryNumber: true },
    });
  }
}
