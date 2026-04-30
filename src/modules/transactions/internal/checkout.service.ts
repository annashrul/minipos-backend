import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CheckoutDto, CheckoutResponse } from "@/contracts";
import { DebtsService } from "../../debts/debts.service";
import { PointsService } from "../../points/points.service";
import { PrismaService } from "../../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../../realtime/realtime.service";
import { InvoiceNumberGenerator } from "./invoice-number.generator";
import { pickStockStrategy } from "./stock-adjustment.strategy";
import {
  aggregateDeductions,
  isInvoiceConflict,
} from "./transactions.helpers";

const TX_TIMEOUT_MS = 15_000;
const TX_MAX_WAIT_MS = 10_000;
const MAX_INVOICE_RETRIES = 3;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly debts: DebtsService,
    private readonly points: PointsService,
    private readonly realtime: RealtimeService,
    private readonly invoiceNumbers: InvoiceNumberGenerator,
  ) {}

  async checkout(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
    retryCount = 0,
  ): Promise<CheckoutResponse> {
    const branchId = dto.branchId ?? null;
    if (branchId) await this.assertBranch(companyId, branchId);
    if (dto.customerId) await this.assertCustomer(companyId, dto.customerId);

    const invoiceNumber = await this.invoiceNumbers.generate(companyId, branchId);
    const shouldValidateStock = await this.shouldValidateStock(branchId);
    const aggregatedDeductions = aggregateDeductions(dto.items);
    const stockStrategy = pickStockStrategy(companyId, branchId);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          if (shouldValidateStock) {
            await stockStrategy.validateAvailability(tx, aggregatedDeductions);
          }

          const paymentsData =
            dto.payments && dto.payments.length > 0
              ? dto.payments
              : [{ method: dto.paymentMethod, amount: dto.paymentAmount }];
          const primaryMethod = paymentsData.reduce((a, b) =>
            a.amount >= b.amount ? a : b,
          ).method;
          const totalPaid = paymentsData.reduce((s, p) => s + p.amount, 0);

          const newTx = await tx.transaction.create({
            data: {
              invoiceNumber,
              userId,
              branchId,
              customerId: dto.customerId ?? null,
              subtotal: dto.subtotal,
              discountAmount: dto.discountAmount,
              taxAmount: dto.taxAmount,
              grandTotal: dto.grandTotal,
              paymentMethod: primaryMethod,
              paymentAmount: totalPaid,
              changeAmount: dto.changeAmount,
              promoApplied: dto.promoApplied ?? null,
              notes: dto.notes ?? null,
              status: "COMPLETED",
              items: {
                create: dto.items.map((item) => {
                  const isBundle = item.productId.startsWith("bundle:");
                  const refProductId =
                    isBundle && item.bundleItems?.[0]
                      ? item.bundleItems[0].productId
                      : item.productId;
                  return {
                    productId: refProductId,
                    productName: item.productName,
                    productCode: item.productCode,
                    quantity: item.quantity,
                    unitName: isBundle ? "PAKET" : item.unitName ?? "PCS",
                    conversionQty: item.conversionQty ?? 1,
                    baseQty: item.quantity * (item.conversionQty ?? 1),
                    unitPrice: item.unitPrice,
                    discount: item.discount,
                    subtotal: item.subtotal,
                    ...(item.modifiers && item.modifiers.length > 0
                      ? {
                          modifiers:
                            item.modifiers as unknown as Prisma.InputJsonValue,
                        }
                      : {}),
                    ...(item.notes ? { notes: item.notes } : {}),
                  };
                }),
              },
              payments: {
                create: paymentsData.map((p) => ({
                  method: p.method,
                  amount: p.amount,
                  reference: ("reference" in p && p.reference) || null,
                })),
              },
            },
            select: { id: true, invoiceNumber: true },
          });

          if (dto.promoIds && dto.promoIds.length > 0) {
            await tx.promotion.updateMany({
              where: { id: { in: Array.from(new Set(dto.promoIds)) } },
              data: { usageCount: { increment: 1 } },
            });
          }

          await stockStrategy.deduct(tx, aggregatedDeductions, invoiceNumber);

          const terminPayment = paymentsData.find(
            (p) => p.method === "TERMIN" && p.amount > 0,
          );
          if (terminPayment && dto.customerId) {
            const customer = await tx.customer.findUnique({
              where: { id: dto.customerId },
              select: { name: true },
            });
            await this.debts.createFromTransaction(tx, {
              companyId,
              userId,
              transactionId: newTx.id,
              invoiceNumber: newTx.invoiceNumber,
              branchId,
              customerId: dto.customerId,
              partyName: customer?.name ?? "Customer",
              amount: terminPayment.amount,
              installment: dto.terminConfig ?? null,
            });
          }

          let pointsEarned = 0;
          let pointsRedeemed = 0;
          if (dto.customerId) {
            if (dto.redeemPoints && dto.redeemPoints > 0) {
              await this.points.redeemForTransaction(tx, {
                customerId: dto.customerId,
                points: dto.redeemPoints,
                invoiceNumber: newTx.invoiceNumber,
              });
              pointsRedeemed = dto.redeemPoints;
            }
            const earn = await this.points.earnFromTransaction(tx, {
              customerId: dto.customerId,
              amount: dto.grandTotal,
              invoiceNumber: newTx.invoiceNumber,
            });
            pointsEarned = earn.earned;
          }

          return { ...newTx, pointsEarned, pointsRedeemed };
        },
        { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
      );

      this.emitCreated(created.id, created.invoiceNumber, dto.branchId);

      return {
        id: created.id,
        invoiceNumber: created.invoiceNumber,
        pointsEarned: created.pointsEarned,
        pointsRedeemed: created.pointsRedeemed,
      };
    } catch (err) {
      if (isInvoiceConflict(err) && retryCount < MAX_INVOICE_RETRIES) {
        return this.checkout(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  private emitCreated(
    transactionId: string,
    invoiceNumber: string,
    branchId: string | null | undefined,
  ): void {
    const emitBranch = branchId ?? undefined;
    this.realtime.emit(
      EVENTS.TRANSACTION_CREATED,
      { transactionId, invoiceNumber },
      emitBranch,
    );
    this.realtime.emit(EVENTS.STOCK_UPDATED, {}, emitBranch);
    this.realtime.emit(EVENTS.DASHBOARD_REFRESH, {}, emitBranch);
  }

  private async assertBranch(companyId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async assertCustomer(
    companyId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
  }

  private async shouldValidateStock(branchId: string | null): Promise<boolean> {
    const setting = branchId
      ? await this.prisma.setting.findFirst({
          where: { key: "pos.validateStock", branchId },
        })
      : null;
    const fallback = setting
      ? null
      : await this.prisma.setting.findFirst({
          where: { key: "pos.validateStock", branchId: null },
        });
    const value = (setting ?? fallback)?.value;
    return value !== "false";
  }
}
