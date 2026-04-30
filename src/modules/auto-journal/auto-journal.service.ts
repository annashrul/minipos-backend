import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type {
  AutoJournalResponse,
  CreateAutoJournalDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

type LineInput = {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
  taxType?: string;
  taxAmount?: number;
  taxBaseAmount?: number;
};

@Injectable()
export class AutoJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    userId: string,
    dto: CreateAutoJournalDto,
  ): Promise<AutoJournalResponse> {
    const { referenceType, referenceId } = dto;
    const branchId = dto.branchId ?? null;
    let description = "";
    let reference = "";
    const lines: LineInput[] = [];

    switch (referenceType) {
      case "TRANSACTION":
        await this.buildTransactionLines(
          referenceId,
          companyId,
          (d, r, ls) => {
            description = d;
            reference = r;
            lines.push(...ls);
          },
        );
        break;
      case "PURCHASE":
        await this.buildPurchaseLines(referenceId, companyId, (d, r, ls) => {
          description = d;
          reference = r;
          lines.push(...ls);
        });
        break;
      case "RETURN":
        await this.buildReturnLines(referenceId, companyId, (d, r, ls) => {
          description = d;
          reference = r;
          lines.push(...ls);
        });
        break;
      case "DEBT_PAYMENT":
        await this.buildDebtPaymentLines(
          referenceId,
          companyId,
          (d, r, ls) => {
            description = d;
            reference = r;
            lines.push(...ls);
          },
        );
        break;
      case "EXPENSE":
        await this.buildExpenseLines(referenceId, companyId, (d, r, ls) => {
          description = d;
          reference = r;
          lines.push(...ls);
        });
        break;
      default:
        throw new BadRequestException(
          `Tipe referensi "${referenceType}" tidak dikenali`,
        );
    }

    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Jurnal tidak seimbang: debit=${totalDebit}, kredit=${totalCredit}`,
      );
    }
    if (lines.length === 0) {
      throw new BadRequestException(
        "Tidak ada entri jurnal yang dihasilkan",
      );
    }

    const today = new Date();
    const currentPeriod = await this.prisma.accountingPeriod.findFirst({
      where: {
        companyId,
        startDate: { lte: today },
        endDate: { gte: today },
        status: "OPEN",
      },
      select: { id: true },
    });

    const entry = await this.runWithEntryNumber(today, async (entryNumber) =>
      this.prisma.journalEntry.create({
        data: {
          entryNumber,
          date: today,
          description,
          reference,
          referenceType,
          referenceId,
          branchId,
          periodId: currentPeriod?.id ?? null,
          status: "POSTED",
          totalDebit,
          totalCredit,
          createdBy: userId,
          lines: {
            createMany: {
              data: lines.map((line, idx) => ({
                accountId: line.accountId,
                description: line.description,
                debit: line.debit,
                credit: line.credit,
                taxType: line.taxType ?? null,
                taxAmount: line.taxAmount ?? null,
                taxBaseAmount: line.taxBaseAmount ?? null,
                sortOrder: idx,
              })),
            },
          },
        },
        select: { id: true, entryNumber: true },
      }),
    );

    return {
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      totalDebit,
      totalCredit,
    };
  }

  // ---------- Builders ----------

  private async buildTransactionLines(
    referenceId: string,
    companyId: string,
    push: (desc: string, ref: string, lines: LineInput[]) => void,
  ) {
    const taxAccountCodes = ["2-1100"];
    const [txn, accs] = await Promise.all([
      this.prisma.transaction.findUnique({
        where: { id: referenceId },
        include: {
          items: {
            include: { product: { select: { purchasePrice: true } } },
          },
          payments: true,
        },
      }),
      this.getSystemAccounts(
        ["1-1001", "1-1002", "1-1003", "1-1004", "4-1001", "5-1001", ...taxAccountCodes],
        companyId,
      ),
    ]);
    if (!txn) throw new NotFoundException("Transaksi tidak ditemukan");

    const cashAccount = accs.get("1-1001")!;
    const bankAccount = accs.get("1-1002")!;
    const receivableAccount = accs.get("1-1003")!;
    const inventoryAccount = accs.get("1-1004")!;
    const revenueAccount = accs.get("4-1001")!;
    const cogsAccount = accs.get("5-1001")!;
    const ppnKeluaranAccount = accs.get("2-1100");

    const lines: LineInput[] = [];

    if (txn.payments && txn.payments.length > 0) {
      let remainingChange = Math.max(txn.changeAmount || 0, 0);
      for (const payment of txn.payments) {
        const appliedChange =
          payment.method === "CASH" && remainingChange > 0
            ? Math.min(remainingChange, payment.amount)
            : 0;
        remainingChange -= appliedChange;
        const netAmount = Math.max(payment.amount - appliedChange, 0);
        if (netAmount <= 0) continue;

        const target =
          payment.method === "CASH"
            ? cashAccount
            : payment.method === "TERMIN"
              ? receivableAccount
              : bankAccount;
        lines.push({
          accountId: target.id,
          description: `Penerimaan ${payment.method} â€” ${txn.invoiceNumber}`,
          debit: netAmount,
          credit: 0,
        });
      }
    } else {
      const target =
        txn.paymentMethod === "CASH"
          ? cashAccount
          : txn.paymentMethod === "TERMIN"
            ? receivableAccount
            : bankAccount;
      lines.push({
        accountId: target.id,
        description: `Penerimaan ${txn.paymentMethod} â€” ${txn.invoiceNumber}`,
        debit: txn.grandTotal,
        credit: 0,
      });
    }

    const taxAmount = txn.taxAmount || 0;
    const dpp = txn.grandTotal - taxAmount;
    lines.push({
      accountId: revenueAccount.id,
      description: `Pendapatan penjualan â€” ${txn.invoiceNumber}`,
      debit: 0,
      credit: dpp,
    });

    if (taxAmount > 0 && ppnKeluaranAccount) {
      lines.push({
        accountId: ppnKeluaranAccount.id,
        description: `PPN Keluaran â€” ${txn.invoiceNumber}`,
        debit: 0,
        credit: taxAmount,
        taxType: "PPN_KELUARAN",
        taxAmount,
        taxBaseAmount: dpp,
      });
    }

    let totalCogs = 0;
    for (const item of txn.items) {
      const costPrice = item.product?.purchasePrice || 0;
      const baseQty = item.baseQty || item.quantity * item.conversionQty;
      totalCogs += costPrice * baseQty;
    }
    if (totalCogs > 0) {
      lines.push({
        accountId: cogsAccount.id,
        description: `HPP â€” ${txn.invoiceNumber}`,
        debit: totalCogs,
        credit: 0,
      });
      lines.push({
        accountId: inventoryAccount.id,
        description: `Pengurangan persediaan â€” ${txn.invoiceNumber}`,
        debit: 0,
        credit: totalCogs,
      });
    }

    push(`Penjualan ${txn.invoiceNumber}`, txn.invoiceNumber, lines);
  }

  private async buildPurchaseLines(
    referenceId: string,
    companyId: string,
    push: (desc: string, ref: string, lines: LineInput[]) => void,
  ) {
    const [po, accs] = await Promise.all([
      this.prisma.purchaseOrder.findUnique({
        where: { id: referenceId },
        include: { supplier: { select: { name: true } } },
      }),
      this.getSystemAccounts(
        ["1-1001", "1-1004", "1-1100", "2-1001"],
        companyId,
      ),
    ]);
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");

    const inventoryAccount = accs.get("1-1004")!;
    const ppnMasukanAccount = accs.get("1-1100");
    const payableAccount = accs.get("2-1001")!;
    const cashAccount = accs.get("1-1001")!;

    const ppnRate = 0.11;
    const dpp = Math.round(po.totalAmount / (1 + ppnRate));
    const ppnAmount = po.totalAmount - dpp;

    const lines: LineInput[] = [];
    lines.push({
      accountId: inventoryAccount.id,
      description: `Persediaan masuk â€” ${po.orderNumber}`,
      debit: dpp,
      credit: 0,
    });
    if (ppnAmount > 0 && ppnMasukanAccount) {
      lines.push({
        accountId: ppnMasukanAccount.id,
        description: `PPN Masukan â€” ${po.orderNumber}`,
        debit: ppnAmount,
        credit: 0,
        taxType: "PPN_MASUKAN",
        taxAmount: ppnAmount,
        taxBaseAmount: dpp,
      });
    }
    const unpaid = po.totalAmount - po.paidAmount;
    if (po.paidAmount > 0) {
      lines.push({
        accountId: cashAccount.id,
        description: `Pembayaran tunai â€” ${po.orderNumber}`,
        debit: 0,
        credit: po.paidAmount,
      });
    }
    if (unpaid > 0) {
      lines.push({
        accountId: payableAccount.id,
        description: `Hutang dagang â€” ${po.orderNumber}`,
        debit: 0,
        credit: unpaid,
      });
    }

    push(
      `Pembelian ${po.orderNumber} â€” ${po.supplier.name}`,
      po.orderNumber,
      lines,
    );
  }

  private async buildReturnLines(
    referenceId: string,
    companyId: string,
    push: (desc: string, ref: string, lines: LineInput[]) => void,
  ) {
    const [ret, accs] = await Promise.all([
      this.prisma.returnExchange.findUnique({
        where: { id: referenceId },
        include: {
          items: {
            include: { product: { select: { purchasePrice: true } } },
          },
        },
      }),
      this.getSystemAccounts(
        ["1-1001", "1-1002", "1-1004", "4-1002", "5-1001"],
        companyId,
      ),
    ]);
    if (!ret) throw new NotFoundException("Return tidak ditemukan");

    const cashAccount = accs.get("1-1001")!;
    const bankAccount = accs.get("1-1002")!;
    const inventoryAccount = accs.get("1-1004")!;
    const returnRevenueAccount = accs.get("4-1002")!;
    const cogsAccount = accs.get("5-1001")!;

    const lines: LineInput[] = [];
    if (ret.totalRefund > 0) {
      lines.push({
        accountId: returnRevenueAccount.id,
        description: `Retur penjualan â€” ${ret.returnNumber}`,
        debit: ret.totalRefund,
        credit: 0,
      });
      const refundAccount =
        ret.refundMethod === "CASH" || !ret.refundMethod
          ? cashAccount
          : bankAccount;
      lines.push({
        accountId: refundAccount.id,
        description: `Pengembalian dana â€” ${ret.returnNumber}`,
        debit: 0,
        credit: ret.totalRefund,
      });
    }
    let returnCogs = 0;
    for (const item of ret.items) {
      returnCogs += (item.product?.purchasePrice || 0) * item.quantity;
    }
    if (returnCogs > 0) {
      lines.push({
        accountId: inventoryAccount.id,
        description: `Persediaan kembali â€” ${ret.returnNumber}`,
        debit: returnCogs,
        credit: 0,
      });
      lines.push({
        accountId: cogsAccount.id,
        description: `Reversal HPP â€” ${ret.returnNumber}`,
        debit: 0,
        credit: returnCogs,
      });
    }

    push(`Retur penjualan ${ret.returnNumber}`, ret.returnNumber, lines);
  }

  private async buildDebtPaymentLines(
    referenceId: string,
    companyId: string,
    push: (desc: string, ref: string, lines: LineInput[]) => void,
  ) {
    const [payment, accs] = await Promise.all([
      this.prisma.debtPayment.findUnique({
        where: { id: referenceId },
        include: {
          debt: {
            select: {
              id: true,
              type: true,
              partyName: true,
              description: true,
            },
          },
        },
      }),
      this.getSystemAccounts(["1-1001", "1-1003", "2-1001"], companyId),
    ]);
    if (!payment) {
      throw new NotFoundException(
        "Pembayaran hutang/piutang tidak ditemukan",
      );
    }

    const cashAccount = accs.get("1-1001")!;
    const receivableAccount = accs.get("1-1003")!;
    const payableAccount = accs.get("2-1001")!;

    const lines: LineInput[] = [];
    let description: string;
    let reference: string;

    if (payment.debt.type === "PAYABLE") {
      description = `Pembayaran hutang â€” ${payment.debt.partyName}`;
      reference = payment.debt.description || `Debt-${payment.debtId}`;
      lines.push({
        accountId: payableAccount.id,
        description: `Pelunasan hutang â€” ${payment.debt.partyName}`,
        debit: payment.amount,
        credit: 0,
      });
      lines.push({
        accountId: cashAccount.id,
        description: `Pembayaran kas â€” ${payment.debt.partyName}`,
        debit: 0,
        credit: payment.amount,
      });
    } else {
      description = `Penerimaan piutang â€” ${payment.debt.partyName}`;
      reference = payment.debt.description || `Debt-${payment.debtId}`;
      lines.push({
        accountId: cashAccount.id,
        description: `Penerimaan kas â€” ${payment.debt.partyName}`,
        debit: payment.amount,
        credit: 0,
      });
      lines.push({
        accountId: receivableAccount.id,
        description: `Pelunasan piutang â€” ${payment.debt.partyName}`,
        debit: 0,
        credit: payment.amount,
      });
    }

    push(description, reference, lines);
  }

  private async buildExpenseLines(
    referenceId: string,
    companyId: string,
    push: (desc: string, ref: string, lines: LineInput[]) => void,
  ) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: referenceId },
    });
    if (!expense) throw new NotFoundException("Pengeluaran tidak ditemukan");

    const categoryLower = expense.category.toLowerCase();
    const expenseAccountCode =
      categoryLower.includes("gaji") || categoryLower.includes("salary")
        ? "5-1003"
        : "5-1002";
    const accs = await this.getSystemAccounts(
      ["1-1001", expenseAccountCode],
      companyId,
    );
    const cashAccount = accs.get("1-1001")!;
    const expenseAccount = accs.get(expenseAccountCode)!;

    const lines: LineInput[] = [
      {
        accountId: expenseAccount.id,
        description: `${expense.category}: ${expense.description}`,
        debit: expense.amount,
        credit: 0,
      },
      {
        accountId: cashAccount.id,
        description: `Pengeluaran kas â€” ${expense.description}`,
        debit: 0,
        credit: expense.amount,
      },
    ];

    push(
      `Beban: ${expense.description}`,
      `EXP-${expense.id.slice(0, 8)}`,
      lines,
    );
  }

  // ---------- Helpers ----------

  private async getSystemAccounts(
    codes: string[],
    companyId: string,
  ): Promise<Map<string, { id: string }>> {
    const accs = await this.prisma.account.findMany({
      where: { code: { in: codes }, category: { companyId } },
      select: { id: true, code: true },
    });
    const map = new Map<string, { id: string }>();
    for (const a of accs) map.set(a.code, { id: a.id });
    const missing = codes.filter((c) => !map.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(
        `System accounts belum tersedia: ${missing.join(", ")}. Jalankan seedDefaultCOA.`,
      );
    }
    return map;
  }

  private async runWithEntryNumber<T>(
    date: Date,
    fn: (entryNumber: string) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const entryNumber = generateEntryNumber(date);
      try {
        return await fn(entryNumber);
      } catch (err) {
        lastErr = err;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }
    if (
      lastErr instanceof Prisma.PrismaClientKnownRequestError &&
      lastErr.code === "P2002"
    ) {
      throw new ConflictException("Gagal generate nomor jurnal, coba lagi");
    }
    throw lastErr;
  }
}

function generateEntryNumber(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `JE-${yyyy}${mm}${dd}-${hex}`;
}
