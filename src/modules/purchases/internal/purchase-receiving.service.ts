import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ClosePurchaseDto,
  ClosePurchaseResponse,
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  assertBranch,
  generateReceiptNumber,
  isReceiptNumberConflict,
} from "./purchases.helpers";
import {
  toPurchaseDetailResponse,
  toReceiptResponse,
} from "./purchases.mapper";
import {
  PO_DETAIL_SELECT,
  RECEIPT_SELECT,
  tenantWhere,
} from "./purchases.select";

const MAX_RECEIPT_NUMBER_RETRIES = 3;

@Injectable()
export class PurchaseReceivingService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseDto,
    retryCount = 0,
  ): Promise<ReceivePurchaseResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const userName = user?.name ?? null;
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        branchId: true,
        supplierId: true,
        supplier: { select: { id: true, name: true } },
        paidAmount: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            receivedQty: true,
            unitPrice: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    if (po.status !== "ORDERED" && po.status !== "PARTIAL") {
      throw new BadRequestException(
        "Hanya purchase order dengan status ORDERED atau PARTIAL yang bisa diterima",
      );
    }

    const targetBranchId = dto.branchId ?? po.branchId ?? null;
    if (targetBranchId)
      await assertBranch(this.prisma, companyId, targetBranchId);

    const itemMap = new Map(po.items.map((it) => [it.productId, it]));
    for (const input of dto.items) {
      const poItem = itemMap.get(input.productId);
      if (!poItem) {
        throw new BadRequestException(
          `Produk ${input.productId} tidak terdapat pada purchase order`,
        );
      }
      const remaining = poItem.quantity - poItem.receivedQty;
      if (input.quantityReceived > remaining) {
        throw new BadRequestException(
          `Jumlah diterima untuk produk ${poItem.product?.name ?? input.productId} melebihi sisa pesanan (sisa: ${remaining})`,
        );
      }
    }

    const receiptNumber = generateReceiptNumber();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const receipt = await tx.goodsReceipt.create({
          data: {
            receiptNumber,
            purchaseOrderId: id,
            companyId,
            branchId: targetBranchId,
            receivedBy: userId,
            receivedByName: userName,
            notes: dto.notes ?? null,
            items: {
              create: dto.items.map((input) => {
                const poItem = itemMap.get(input.productId);
                return {
                  productId: input.productId,
                  productName: poItem?.product?.name ?? "",
                  quantityOrdered: poItem?.quantity ?? 0,
                  quantityReceived: input.quantityReceived,
                  notes: input.notes ?? null,
                };
              }),
            },
          },
          select: { id: true },
        });

        for (const input of dto.items) {
          const poItem = itemMap.get(input.productId);
          if (!poItem) continue;
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { receivedQty: { increment: input.quantityReceived } },
          });
        }

        for (const input of dto.items) {
          if (targetBranchId) {
            await tx.branchStock.upsert({
              where: {
                branchId_productId: {
                  branchId: targetBranchId,
                  productId: input.productId,
                },
              },
              create: {
                branchId: targetBranchId,
                productId: input.productId,
                quantity: input.quantityReceived,
              },
              update: {
                quantity: { increment: input.quantityReceived },
              },
            });
          } else {
            await tx.product.update({
              where: { id: input.productId },
              data: { stock: { increment: input.quantityReceived } },
            });
          }

          await tx.stockMovement.create({
            data: {
              productId: input.productId,
              branchId: targetBranchId,
              companyId,
              type: "IN",
              quantity: input.quantityReceived,
              note: `Penerimaan ${receiptNumber}`,
              reference: receiptNumber,
              createdBy: userId,
            },
          });
        }

        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
          select: { quantity: true, receivedQty: true, unitPrice: true },
        });
        const allReceived = updatedItems.every(
          (it) => it.receivedQty >= it.quantity,
        );
        const newReceivedAmount = updatedItems.reduce(
          (sum, it) => sum + it.receivedQty * it.unitPrice,
          0,
        );

        const grandTotalReceipt = dto.items.reduce((sum, input) => {
          const poItem = itemMap.get(input.productId);
          if (!poItem) return sum;
          return sum + input.quantityReceived * poItem.unitPrice;
        }, 0);

        const incomingPaid = Math.max(dto.paidAmount ?? 0, 0);
        const debtRemaining = Math.max(grandTotalReceipt - incomingPaid, 0);
        let createdDebtId: string | null = null;

        if (incomingPaid > 0) {
          await tx.purchaseOrder.update({
            where: { id },
            data: { paidAmount: { increment: incomingPaid } },
          });
        }

        if (debtRemaining > 0 && po.supplierId) {
          const debt = await tx.debt.create({
            data: {
              type: "PAYABLE",
              referenceType: "PURCHASE",
              referenceId: id,
              partyType: "SUPPLIER",
              partyId: po.supplierId,
              partyName: po.supplier?.name ?? "Supplier",
              description: `Hutang penerimaan ${receiptNumber} (PO ${po.orderNumber})`,
              totalAmount: debtRemaining,
              paidAmount: 0,
              remainingAmount: debtRemaining,
              status: "UNPAID",
              dueDate: dto.debtDueDate ? new Date(dto.debtDueDate) : null,
              branchId: targetBranchId,
              companyId,
              createdBy: userId,
            },
            select: { id: true },
          });
          createdDebtId = debt.id;
        }

        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: allReceived ? "RECEIVED" : "PARTIAL",
            receivedDate: allReceived ? new Date() : undefined,
            receivedAmount: newReceivedAmount,
          },
        });

        const refreshedReceipt = await tx.goodsReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
          select: RECEIPT_SELECT,
        });
        const refreshedPO = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          select: PO_DETAIL_SELECT,
        });

        return {
          receipt: refreshedReceipt,
          purchaseOrder: refreshedPO,
          debtId: createdDebtId,
          debtRemaining: debtRemaining > 0 ? debtRemaining : null,
        };
      });

      return {
        receipt: toReceiptResponse(result.receipt),
        purchaseOrder: toPurchaseDetailResponse(result.purchaseOrder),
        debtId: result.debtId,
        debtRemaining: result.debtRemaining,
      };
    } catch (err) {
      if (
        isReceiptNumberConflict(err) &&
        retryCount < MAX_RECEIPT_NUMBER_RETRIES
      ) {
        return this.receive(companyId, userId, id, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async close(
    companyId: string,
    id: string,
    dto: ClosePurchaseDto,
  ): Promise<ClosePurchaseResponse> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        receivedAmount: true,
        paidAmount: true,
        notes: true,
      },
    });
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    if (po.status !== "PARTIAL") {
      throw new BadRequestException(
        "Hanya PO berstatus PARTIAL yang dapat ditutup",
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const closingNote = (dto.discrepancyNote ?? "").trim();
      const composedNotes = closingNote
        ? po.notes
          ? `${po.notes}\n[CLOSED] ${closingNote}`
          : `[CLOSED] ${closingNote}`
        : po.notes;

      const debts = await tx.debt.findMany({
        where: {
          referenceType: "PURCHASE",
          referenceId: id,
          status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
        },
        select: {
          id: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
        },
        orderBy: { createdAt: "desc" },
      });

      let debtAdjusted = false;
      const firstDebtId: string | null = debts[0]?.id ?? null;
      const firstDebtBefore: number | null =
        debts[0]?.remainingAmount ?? null;
      let firstDebtAfter: number | null = debts[0]?.remainingAmount ?? null;

      if (dto.adjustDebt && debts.length > 0) {
        let pendingReduction = Math.max(
          po.totalAmount - po.receivedAmount,
          0,
        );

        for (const d of debts) {
          if (pendingReduction <= 0) break;
          const reduce = Math.min(pendingReduction, d.remainingAmount);
          const newTotal = Math.max(d.totalAmount - reduce, d.paidAmount);
          const newRemaining = Math.max(newTotal - d.paidAmount, 0);
          const newStatus =
            newRemaining <= 0
              ? "PAID"
              : d.paidAmount > 0
                ? "PARTIAL"
                : "UNPAID";

          await tx.debt.update({
            where: { id: d.id },
            data: {
              totalAmount: newTotal,
              remainingAmount: newRemaining,
              status: newStatus,
            },
          });
          if (d.id === firstDebtId) {
            firstDebtAfter = newRemaining;
          }
          pendingReduction -= reduce;
          debtAdjusted = true;
        }
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedDate: new Date(),
          closingNotes: closingNote || null,
          notes: composedNotes,
        },
      });

      const refreshed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        select: PO_DETAIL_SELECT,
      });

      return {
        purchaseOrder: refreshed,
        debtAdjusted,
        debtId: firstDebtId,
        debtRemainingBefore: firstDebtBefore,
        debtRemainingAfter: firstDebtAfter,
      };
    });

    return {
      purchaseOrder: toPurchaseDetailResponse(result.purchaseOrder),
      debtAdjusted: result.debtAdjusted,
      debtId: result.debtId,
      debtRemainingBefore: result.debtRemainingBefore,
      debtRemainingAfter: result.debtRemainingAfter,
    };
  }
}
