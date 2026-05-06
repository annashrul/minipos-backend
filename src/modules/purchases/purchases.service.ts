import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClosePurchaseDto,
  ClosePurchaseResponse,
  CreatePurchaseDto,
  GoodsReceiptItemResponse,
  GoodsReceiptResponse,
  ListPurchasesQueryDto,
  PurchaseListResponse,
  PurchaseOrderDetailResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  PurchaseOrderStatusDto,
  PurchaseSummaryResponse,
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
  UpdatePurchaseDto,
  UpdatePurchaseStatusDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const PO_ITEM_SELECT = {
  id: true,
  purchaseOrderId: true,
  productId: true,
  product: { select: { id: true, code: true, name: true } },
  quantity: true,
  receivedQty: true,
  unitPrice: true,
  subtotal: true,
} satisfies Prisma.PurchaseOrderItemSelect;

const PO_SELECT = {
  id: true,
  orderNumber: true,
  supplierId: true,
  supplier: { select: { id: true, name: true, companyId: true } },
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  totalAmount: true,
  receivedAmount: true,
  paidAmount: true,
  notes: true,
  orderDate: true,
  expectedDate: true,
  receivedDate: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  items: { select: PO_ITEM_SELECT, orderBy: { createdAt: "asc" } },
  _count: { select: { goodsReceipts: true } },
} satisfies Prisma.PurchaseOrderSelect;

const RECEIPT_ITEM_SELECT = {
  id: true,
  goodsReceiptId: true,
  productId: true,
  productName: true,
  quantityOrdered: true,
  quantityReceived: true,
  notes: true,
} satisfies Prisma.GoodsReceiptItemSelect;

const RECEIPT_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  receivedBy: true,
  receivedByName: true,
  notes: true,
  receivedAt: true,
  createdAt: true,
  items: { select: RECEIPT_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.GoodsReceiptSelect;

const PO_DETAIL_SELECT = {
  ...PO_SELECT,
  goodsReceipts: { select: RECEIPT_SELECT, orderBy: { receivedAt: "desc" } },
} satisfies Prisma.PurchaseOrderSelect;

type RawPO = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_SELECT }>;
type RawPODetail = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_DETAIL_SELECT;
}>;
type RawReceipt = Prisma.GoodsReceiptGetPayload<{
  select: typeof RECEIPT_SELECT;
}>;

const ALLOWED_TRANSITIONS: Record<
  PurchaseOrderStatusDto,
  PurchaseOrderStatusDto[]
> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        select: PO_SELECT,
        orderBy: { orderDate: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      purchases: rows.map(toPurchaseResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async summary(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseSummaryResponse> {
    const where = this.buildListWhere(companyId, query);

    const [agg, byStatus] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ["status"],
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalCount: agg._count._all,
      totalAmount: agg._sum.totalAmount ?? 0,
      byStatus: byStatus.map((row) => ({
        status: row.status as PurchaseOrderStatusDto,
        count: row._count._all,
        totalAmount: row._sum.totalAmount ?? 0,
      })),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: PO_DETAIL_SELECT,
    });
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    return toPurchaseDetailResponse(po);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseDto,
    retryCount = 0,
  ): Promise<PurchaseOrderDetailResponse> {
    await this.assertSupplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
    const orderNumber = generateOrderNumber();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            supplierId: dto.supplierId,
            branchId: dto.branchId ?? null,
            companyId,
            status: "DRAFT",
            totalAmount,
            notes: dto.notes ?? null,
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
            createdBy: userId,
            items: {
              create: dto.items.map((it) => ({
                productId: it.productId,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
              })),
            },
          },
          select: { id: true },
        });

        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id: po.id },
          select: PO_DETAIL_SELECT,
        });
      });

      return toPurchaseDetailResponse(created);
    } catch (err) {
      if (isOrderNumberConflict(err) && retryCount < 3) {
        return this.create(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT" && existing.status !== "ORDERED") {
      throw new BadRequestException(
        "Purchase order hanya bisa diubah saat status DRAFT atau ORDERED",
      );
    }

    if (dto.supplierId) await this.assertSupplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (dto.supplierId !== undefined) {
        data.supplier = { connect: { id: dto.supplierId } };
      }
      if (dto.branchId !== undefined) {
        data.branch = dto.branchId
          ? { connect: { id: dto.branchId } }
          : { disconnect: true };
      }
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.expectedDate !== undefined) {
        data.expectedDate = dto.expectedDate
          ? new Date(dto.expectedDate)
          : null;
      }

      if (dto.items) {
        const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
        data.totalAmount = totalAmount;
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });
        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((it) => ({
            purchaseOrderId: id,
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            subtotal: it.subtotal,
          })),
        });
      }

      await tx.purchaseOrder.update({ where: { id }, data });

      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        select: PO_DETAIL_SELECT,
      });
    });

    return toPurchaseDetailResponse(updated);
  }

  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdatePurchaseStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");

    const current = existing.status as PurchaseOrderStatusDto;
    const next = dto.status;
    if (current === next) {
      throw new BadRequestException(`Status sudah ${current}`);
    }
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Transisi status dari ${current} ke ${next} tidak diizinkan`,
      );
    }

    const data: Prisma.PurchaseOrderUpdateInput = { status: next };
    if (next === "RECEIVED") data.receivedDate = new Date();
    if (next === "CLOSED") data.closedDate = new Date();

    await this.prisma.purchaseOrder.update({ where: { id }, data });

    const refreshed = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: PO_DETAIL_SELECT,
    });
    return toPurchaseDetailResponse(refreshed);
  }

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
      where: { id, ...this.tenantWhere(companyId) },
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
    if (targetBranchId) await this.assertBranch(companyId, targetBranchId);

    // Validate every product exists in PO and total received doesn't exceed ordered
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

        // Update PurchaseOrderItem.receivedQty
        for (const input of dto.items) {
          const poItem = itemMap.get(input.productId);
          if (!poItem) continue;
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { receivedQty: { increment: input.quantityReceived } },
          });
        }

        // Update stock + create stock movement (ledger fields lengkap)
        for (const input of dto.items) {
          // Lookup unit cost dari PO item supaya HPP per movement ter-isi
          // (foundation untuk Average/FIFO costing).
          const poItem = itemMap.get(input.productId);
          const unitCost = poItem?.unitPrice ?? 0;

          let balanceAfter: number | null = null;
          if (targetBranchId) {
            const updated = await tx.branchStock.upsert({
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
              select: { quantity: true },
            });
            balanceAfter = updated.quantity;
          } else {
            const updated = await tx.product.update({
              where: { id: input.productId },
              data: { stock: { increment: input.quantityReceived } },
              select: { stock: true },
            });
            balanceAfter = updated.stock;
          }

          await tx.stockMovement.create({
            data: {
              productId: input.productId,
              branchId: targetBranchId,
              companyId,
              type: "PURCHASE_RECEIVE",
              quantity: input.quantityReceived,
              direction: "IN",
              balanceAfter,
              ...(unitCost > 0
                ? {
                    unitCost,
                    totalCost:
                      Math.round(unitCost * input.quantityReceived * 100) /
                      100,
                  }
                : {}),
              refType: "purchase_order",
              refId: id,
              refNumber: receiptNumber,
              note: `Penerimaan ${receiptNumber}`,
              reference: receiptNumber,
              createdBy: userId,
            },
          });
        }

        // Re-fetch PO items to determine new status + receivedAmount
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

        // Compute incoming-receipt's grandTotal (use ordered unitPrice).
        const grandTotalReceipt = dto.items.reduce((sum, input) => {
          const poItem = itemMap.get(input.productId);
          if (!poItem) return sum;
          return sum + input.quantityReceived * poItem.unitPrice;
        }, 0);

        const incomingPaid = Math.max(dto.paidAmount ?? 0, 0);
        const debtRemaining = Math.max(grandTotalReceipt - incomingPaid, 0);
        let createdDebtId: string | null = null;

        // Track payment on the PO + create supplier debt for unpaid portion.
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
      if (isReceiptNumberConflict(err) && retryCount < 3) {
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
      where: { id, ...this.tenantWhere(companyId) },
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
      // Append discrepancy/closing notes onto the PO record.
      const closingNote = (dto.discrepancyNote ?? "").trim();
      const composedNotes = closingNote
        ? po.notes
          ? `${po.notes}\n[CLOSED] ${closingNote}`
          : `[CLOSED] ${closingNote}`
        : po.notes;

      // Locate any open supplier debt(s) tied to this PO so we can adjust.
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
      let firstDebtId: string | null = debts[0]?.id ?? null;
      let firstDebtBefore: number | null = debts[0]?.remainingAmount ?? null;
      let firstDebtAfter: number | null = debts[0]?.remainingAmount ?? null;

      if (dto.adjustDebt && debts.length > 0) {
        // Total receivable adjustment = totalAmount - receivedAmount.
        // Distribute the reduction across open debts (newest first).
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

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        status: true,
        _count: { select: { goodsReceipts: true } },
      },
    });
    if (!existing) throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya purchase order dengan status DRAFT yang bisa dihapus",
      );
    }
    if (existing._count.goodsReceipts > 0) {
      throw new BadRequestException(
        "Purchase order yang sudah memiliki penerimaan tidak bisa dihapus",
      );
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const { search, status, supplierId, branchId, from, to } = query;
    const where: Prisma.PurchaseOrderWhereInput = this.tenantWhere(companyId);
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        {
          supplier: {
            name: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }
    if (from || to) {
      where.orderDate = {};
      if (from) where.orderDate.gte = new Date(from);
      if (to) where.orderDate.lte = new Date(to);
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.PurchaseOrderWhereInput {
    return {
      OR: [
        { companyId },
        { supplier: { companyId } },
        { branch: { companyId } },
      ],
    };
  }

  private async assertSupplier(companyId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException("Supplier tidak ditemukan");
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayCompact(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomHex(length: number): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateOrderNumber(): string {
  return `PO-${todayCompact()}-${randomHex(6)}`;
}

function generateReceiptNumber(): string {
  return `GR-${todayCompact()}-${randomHex(6)}`;
}

function isOrderNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("orderNumber")) return true;
  }
  return false;
}

function isReceiptNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("receiptNumber")) return true;
  }
  return false;
}

function toPOItemResponse(
  it: RawPO["items"][number],
): PurchaseOrderItemResponse {
  return {
    id: it.id,
    purchaseOrderId: it.purchaseOrderId,
    productId: it.productId,
    product: it.product
      ? { id: it.product.id, code: it.product.code, name: it.product.name }
      : null,
    quantity: it.quantity,
    receivedQty: it.receivedQty,
    unitPrice: it.unitPrice,
    subtotal: it.subtotal,
  };
}

function toPurchaseResponse(po: RawPO): PurchaseOrderResponse {
  return {
    id: po.id,
    orderNumber: po.orderNumber,
    supplierId: po.supplierId,
    supplier: po.supplier
      ? { id: po.supplier.id, name: po.supplier.name }
      : null,
    branchId: po.branchId,
    branch: po.branch ? { id: po.branch.id, name: po.branch.name } : null,
    status: po.status as PurchaseOrderStatusDto,
    totalAmount: po.totalAmount,
    receivedAmount: po.receivedAmount,
    paidAmount: po.paidAmount,
    notes: po.notes,
    orderDate: po.orderDate.toISOString(),
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    receivedDate: po.receivedDate ? po.receivedDate.toISOString() : null,
    createdBy: po.createdBy,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    items: po.items.map(toPOItemResponse),
    receiptCount: po._count.goodsReceipts,
  };
}

function toPurchaseDetailResponse(
  po: RawPODetail,
): PurchaseOrderDetailResponse {
  return {
    ...toPurchaseResponse(po),
    receipts: po.goodsReceipts.map(toReceiptResponse),
  };
}

function toReceiptItemResponse(
  it: RawReceipt["items"][number],
): GoodsReceiptItemResponse {
  return {
    id: it.id,
    goodsReceiptId: it.goodsReceiptId,
    productId: it.productId,
    productName: it.productName,
    quantityOrdered: it.quantityOrdered,
    quantityReceived: it.quantityReceived,
    notes: it.notes,
  };
}

function toReceiptResponse(r: RawReceipt): GoodsReceiptResponse {
  return {
    id: r.id,
    receiptNumber: r.receiptNumber,
    purchaseOrderId: r.purchaseOrderId,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    receivedBy: r.receivedBy,
    receivedByName: r.receivedByName,
    notes: r.notes,
    receivedAt: r.receivedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    items: r.items.map(toReceiptItemResponse),
  };
}
