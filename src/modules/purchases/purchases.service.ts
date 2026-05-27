import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { round2 } from "@/common/utils/math";
import { AssertService } from "@/common/assert/assert.service";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  ClosePurchaseDto,
  ClosePurchaseResponse,
  CreatePurchaseDto,
  GoodsReceiptItemResponse,
  GoodsReceiptResponse,
  ListPurchaseTransactionLogQueryDto,
  ListPurchasesQueryDto,
  PurchaseOrderDetailResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  PurchaseOrderStatusDto,
  PurchaseSummaryResponse,
  PurchaseTransactionLogResponse,
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
  UpdatePurchaseDto,
  UpdatePurchaseStatusDto,
} from "./dto/purchases.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RackStockHelperService } from "@/modules/racks/rack-stock-helper.service";
import { tenantWhere } from "@/common/utils/tenant";
import {
  PurchasesRepository,
  PO_DETAIL_SELECT,
  RECEIPT_SELECT,
  type RawPO,
  type RawPODetail,
  type RawReceipt,
} from "./purchases.repository";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PurchasesRepository,
    private readonly rackStockHelper: RackStockHelperService,
    private readonly assert: AssertService,
  ) {}

  async list(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PaginatedResponse<PurchaseOrderResponse>> {
    const where = this.buildListWhere(companyId, query);
    const { page, perPage } = query;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toPurchaseResponse), total, page, perPage);
  }

  async summary(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Promise<PurchaseSummaryResponse> {
    const where = this.buildListWhere(companyId, query);

    const [agg, byStatus] = await Promise.all([
      this.repo.aggregate(where),
      this.repo.groupByStatus(where),
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
    const po = await this.repo.findById(companyId, id);
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    return toPurchaseDetailResponse(po);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseDto,
    retryCount = 0,
  ): Promise<PurchaseOrderDetailResponse> {
    await this.assert.supplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

    const totalAmount = dto.items.reduce((sum, it) => sum + it.subtotal, 0);
    const orderNumber = await this.repo.nextOrderNumber(companyId);
    const purchaseTransactionNumber =
      await this.repo.nextPurchaseTransactionNumber(companyId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            purchaseTransactionNumber,
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
                unitId: it.unitId ?? null,
                variantId: it.variantId ?? null,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
              })),
            },
          },
          select: { id: true },
        });

        // Log row pertama: status DRAFT dengan no transaksi = BL number.
        await tx.purchaseTransactionLog.create({
          data: {
            companyId,
            branchId: dto.branchId ?? null,
            purchaseOrderId: po.id,
            documentNumber: purchaseTransactionNumber,
            documentType: "BL",
            status: "DRAFT",
            amount: totalAmount,
            createdBy: userId,
          },
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
    const existing = await this.repo.findByIdForUpdate(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");
    if (existing.status !== "DRAFT" && existing.status !== "ORDERED") {
      throw new BadRequestException(
        "Purchase order hanya bisa diubah saat status DRAFT atau ORDERED",
      );
    }

    if (dto.supplierId) await this.assert.supplier(companyId, dto.supplierId);
    if (dto.branchId) await this.assert.branch(companyId, dto.branchId);

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
            unitId: it.unitId ?? null,
            variantId: it.variantId ?? null,
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
    userId: string,
    id: string,
    dto: UpdatePurchaseStatusDto,
  ): Promise<PurchaseOrderDetailResponse> {
    const existing = await this.repo.findByIdForStatusUpdate(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");

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

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id }, data });
      // Log perubahan status: docNumber tetap PO number untuk transisi
      // status biasa (ORDERED/CANCELLED).
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: existing.branchId,
          purchaseOrderId: id,
          documentNumber: existing.orderNumber,
          documentType: "PO",
          status: next,
          amount: existing.totalAmount,
          createdBy: userId,
        },
      });
    });

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
    const user = await this.repo.findUserName(userId);
    const userName = user?.name ?? null;
    const po = await this.repo.findByIdForReceive(companyId, id);
    if (!po) throw new NotFoundException("Purchase order tidak ditemukan");
    if (po.status !== "ORDERED" && po.status !== "PARTIAL") {
      throw new BadRequestException(
        "Hanya purchase order dengan status ORDERED atau PARTIAL yang bisa diterima",
      );
    }

    const targetBranchId = dto.branchId ?? po.branchId ?? null;
    if (targetBranchId) await this.assert.branch(companyId, targetBranchId);

    // Build item maps. Untuk PO multi-varian (1 productId punya N item dgn
    // variantId berbeda), match WAJIB pakai purchaseOrderItemId. Fallback
    // ke productId hanya kalau cuma ada 1 item utk product itu (back-compat).
    const itemById = new Map(po.items.map((it) => [it.id, it]));
    const itemsByProductId = new Map<string, typeof po.items>();
    for (const it of po.items) {
      const arr = itemsByProductId.get(it.productId) ?? [];
      arr.push(it);
      itemsByProductId.set(it.productId, arr);
    }
    // Resolve PO item per receive line. Stamp `_resolvedPoItemId` ke input
    // supaya looping berikutnya tidak perlu lookup ulang.
    type ResolvedInput = (typeof dto.items)[number] & {
      _resolvedPoItemId: string;
    };
    const resolvedInputs: ResolvedInput[] = [];
    for (const input of dto.items) {
      let poItem: (typeof po.items)[number] | undefined;
      if (input.purchaseOrderItemId) {
        poItem = itemById.get(input.purchaseOrderItemId);
        if (!poItem) {
          throw new BadRequestException(
            `Item PO ${input.purchaseOrderItemId} tidak ditemukan`,
          );
        }
      } else if (input.productId) {
        const candidates = itemsByProductId.get(input.productId) ?? [];
        if (candidates.length === 0) {
          throw new BadRequestException(
            `Produk ${input.productId} tidak terdapat pada purchase order`,
          );
        }
        if (candidates.length > 1) {
          throw new BadRequestException(
            `Produk ${candidates[0]?.product?.name ?? input.productId} punya beberapa item PO (varian/satuan berbeda) — frontend wajib kirim purchaseOrderItemId`,
          );
        }
        poItem = candidates[0]!;
      } else {
        throw new BadRequestException(
          "purchaseOrderItemId atau productId wajib diisi",
        );
      }
      const remaining = poItem.quantity - poItem.receivedQty;
      if (input.quantityReceived > remaining) {
        throw new BadRequestException(
          `Jumlah diterima untuk produk ${poItem.product?.name ?? poItem.productId} melebihi sisa pesanan (sisa: ${remaining})`,
        );
      }
      resolvedInputs.push({ ...input, _resolvedPoItemId: poItem.id });
    }

    const receiptNumber = await this.repo.nextReceiptNumber(companyId);

    // Pre-pass: snapshot harga master sebelum di-sync. Map keyed by resolved
    // PO item id supaya bisa di-lookup saat create GR item + saat compare.
    const oldPriceByPoItemId = new Map<string, number | null>();
    for (const input of resolvedInputs) {
      const poItem = itemById.get(input._resolvedPoItemId)!;
      let oldPrice: number | null = null;
      if (poItem.unitId) {
        const u = await this.repo.findProductUnitPrice(poItem.unitId);
        oldPrice = u?.purchasePrice ?? null;
      } else if (poItem.variantId) {
        const v = await this.repo.findVariantPrice(poItem.variantId);
        oldPrice =
          v?.purchasePriceOverride ?? v?.product?.purchasePrice ?? null;
      } else {
        const p = await this.repo.findProductPrice(poItem.productId);
        oldPrice = p?.purchasePrice ?? null;
      }
      oldPriceByPoItemId.set(input._resolvedPoItemId, oldPrice);
    }

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
              create: resolvedInputs.map((input) => {
                const poItem = itemById.get(input._resolvedPoItemId)!;
                return {
                  productId: poItem.productId,
                  productName: poItem.product?.name ?? "",
                  quantityOrdered: poItem.quantity,
                  quantityReceived: input.quantityReceived,
                  unitPrice: poItem.unitPrice ?? null,
                  previousPurchasePrice:
                    oldPriceByPoItemId.get(input._resolvedPoItemId) ?? null,
                  notes: input.notes ?? null,
                };
              }),
            },
          },
          select: { id: true },
        });

        // Update PurchaseOrderItem.receivedQty per PO item id (variant-aware).
        // Capture previousPurchasePrice sekali pada receive pertama (kalau
        // masih null) supaya laporan pembelian punya snapshot harga lama.
        for (const input of resolvedInputs) {
          const poItem = itemById.get(input._resolvedPoItemId)!;
          const oldPrice = oldPriceByPoItemId.get(input._resolvedPoItemId);
          const shouldCaptureOldPrice =
            (poItem as unknown as { previousPurchasePrice?: number | null })
              .previousPurchasePrice == null && oldPrice != null;
          await tx.purchaseOrderItem.update({
            where: { id: input._resolvedPoItemId },
            data: {
              receivedQty: { increment: input.quantityReceived },
              ...(shouldCaptureOldPrice
                ? { previousPurchasePrice: oldPrice }
                : {}),
            },
          });
        }

        // Update stock + create stock movement (ledger fields lengkap).
        // Loop per resolved PO item supaya variant + unit info ke-pakai utk
        // increment ProductBranchSku yg tepat (per varian).
        for (const input of resolvedInputs) {
          const poItem = itemById.get(input._resolvedPoItemId)!;
          const productId = poItem.productId;
          const variantId = poItem.variantId ?? null;
          const variantLabel = poItem.variant
            ? poItem.variant.options.map((o) => o.option.name).join(" · ") ||
              null
            : null;
          const unitCost = poItem.unitPrice ?? 0;

          let balanceAfter: number | null = null;
          if (targetBranchId) {
            const updated = await tx.branchStock.upsert({
              where: {
                branchId_productId: {
                  branchId: targetBranchId,
                  productId,
                },
              },
              create: {
                branchId: targetBranchId,
                productId,
                quantity: input.quantityReceived,
              },
              update: {
                quantity: { increment: input.quantityReceived },
              },
              select: { quantity: true },
            });
            balanceAfter = updated.quantity;

            // Phase 2B: tempatkan qty terima ke rak. Pakai rackId dari input
            // kalau ada, fallback ke product.defaultRackId. Kalau produk tidak
            // punya rak sama sekali, qty stays "unassigned" di BranchStock.
            await this.rackStockHelper.addToRack(tx, {
              branchId: targetBranchId,
              productId,
              qty: input.quantityReceived,
              rackId: input.rackId ?? null,
              refType: "purchase_order",
              refId: po.id,
              notes: `Terima PO ${po.purchaseTransactionNumber}`,
              movementType: "PURCHASE_RECEIVE",
            });

            // Sync ProductBranchSku per varian. Match EXACT (productId,
            // branchId, variantId, unitId) supaya target SKU row tepat —
            // Postgres `ORDER BY unitId ASC` default `NULLS LAST` jadi
            // tidak bisa diandalkan utk pick base-unit row.
            const skuUnitId = poItem.unitId ?? null;
            const skuRow = await tx.productBranchSku.findFirst({
              where: {
                productId,
                branchId: targetBranchId,
                variantId,
                unitId: skuUnitId,
              },
              select: { id: true },
            });
            if (skuRow) {
              await tx.productBranchSku.update({
                where: { id: skuRow.id },
                data: {
                  stock: { increment: input.quantityReceived },
                  // Sync harga beli SKU per cabang ke harga PO terakhir.
                  ...(unitCost > 0 ? { purchasePrice: unitCost } : {}),
                },
              });
            } else {
              // Fallback: kalau row belum ada (edge case data lama), buat
              // row baru dengan harga dari PO + stok awal = qty diterima.
              await tx.productBranchSku.create({
                data: {
                  productId,
                  branchId: targetBranchId,
                  unitId: skuUnitId,
                  variantId,
                  sellingPrice: 0,
                  purchasePrice: poItem.unitPrice,
                  stock: input.quantityReceived,
                  minStock: 5,
                  isActive: true,
                },
              });
            }
          } else {
            const updated = await tx.product.update({
              where: { id: productId },
              data: { stock: { increment: input.quantityReceived } },
              select: { stock: true },
            });
            balanceAfter = updated.stock;
          }

          // Sync master harga beli ke harga PO terbaru. Skip kalau unitCost<=0
          // (mungkin data salah / belum input harga).
          if (unitCost > 0) {
            if (poItem.unitId) {
              // Item pakai satuan turunan → update ProductUnit.purchasePrice.
              await tx.productUnit.update({
                where: { id: poItem.unitId },
                data: { purchasePrice: unitCost },
              });
            }
            // Update Product.purchasePrice (master di list produk) kalau:
            // - PO tanpa unit (base unit) ATAU
            // - PO pakai unit yang merupakan default / conversionQty=1
            // Skip kalau ada variant (variant override jadi sumber harga).
            const isBaseUnit =
              !poItem.unitId ||
              poItem.unit?.isDefault === true ||
              poItem.unit?.conversionQty === 1;
            if (!variantId && isBaseUnit) {
              await tx.product.update({
                where: { id: productId },
                data: { purchasePrice: unitCost },
              });
            }
            if (variantId) {
              // Sync override harga beli per varian.
              await tx.productVariant.update({
                where: { id: variantId },
                data: { purchasePriceOverride: unitCost },
              });
            }
            // Legacy BranchProductPrice — view vw_product_branch (dipakai list
            // produk dgn filter cabang) baca harga dari sini lewat COALESCE.
            // Kalau row legacy ada, harga master ke-overlay dgn nilai lama
            // selama row legacy belum ke-update. Upsert harga PO terbaru ke
            // sini supaya overlay konsisten dgn master.
            if (targetBranchId && !variantId && isBaseUnit) {
              await tx.branchProductPrice.upsert({
                where: {
                  branchId_productId: {
                    branchId: targetBranchId,
                    productId,
                  },
                },
                create: {
                  branchId: targetBranchId,
                  productId,
                  sellingPrice: 0,
                  purchasePrice: unitCost,
                },
                update: { purchasePrice: unitCost },
              });
            }
          }

          await tx.stockMovement.create({
            data: {
              productId,
              branchId: targetBranchId,
              variantId,
              variantLabel,
              companyId,
              type: "PURCHASE_RECEIVE",
              quantity: input.quantityReceived,
              direction: "IN",
              balanceAfter,
              ...(unitCost > 0
                ? {
                    unitCost,
                    totalCost:
                      round2(unitCost * input.quantityReceived),
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

        const [poItemSummary] = await tx.$queryRaw<
          [{ unreceived_count: bigint; received_amount: number }]
        >`
          SELECT
            COUNT(*) FILTER (WHERE "receivedQty" < "quantity") AS "unreceived_count",
            COALESCE(SUM("receivedQty" * "unitPrice"), 0) AS "received_amount"
          FROM purchase_order_items
          WHERE "purchaseOrderId" = ${id}
        `;
        const allReceived = Number(poItemSummary.unreceived_count) === 0;
        const newReceivedAmount = Number(poItemSummary.received_amount);

        // Compute incoming-receipt's grandTotal (use ordered unitPrice).
        const grandTotalReceipt = resolvedInputs.reduce((sum, input) => {
          const poItem = itemById.get(input._resolvedPoItemId);
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
              description: `Hutang penerimaan ${receiptNumber} (${po.orderNumber})`,
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

        const newStatus = allReceived ? "RECEIVED" : "PARTIAL";
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: newStatus,
            receivedDate: allReceived ? new Date() : undefined,
            receivedAmount: newReceivedAmount,
          },
        });

        // Log: status PARTIAL/RECEIVED dgn docNumber = GR (receipt number).
        await tx.purchaseTransactionLog.create({
          data: {
            companyId,
            branchId: targetBranchId,
            purchaseOrderId: id,
            documentNumber: receiptNumber,
            documentType: "GR",
            status: newStatus,
            amount: grandTotalReceipt,
            note: dto.notes ?? null,
            createdBy: userId,
          },
        });

        // Kalau selesai → log row tambahan COMPLETED pakai BL number
        // (purchaseTransactionNumber yg sudah generated saat create PO).
        if (allReceived) {
          await tx.purchaseTransactionLog.create({
            data: {
              companyId,
              branchId: targetBranchId,
              purchaseOrderId: id,
              documentNumber: po.purchaseTransactionNumber,
              documentType: "BL",
              status: "COMPLETED",
              amount: newReceivedAmount,
              createdBy: userId,
            },
          });
        }

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
    userId: string,
    id: string,
    dto: ClosePurchaseDto,
  ): Promise<ClosePurchaseResponse> {
    const po = await this.repo.findByIdForClose(companyId, id);
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
        let pendingReduction = Math.max(po.totalAmount - po.receivedAmount, 0);

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

      // Log: status CLOSED dgn docNumber tetap PO number.
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: po.branchId,
          purchaseOrderId: id,
          documentNumber: po.orderNumber,
          documentType: "PO",
          status: "CLOSED",
          amount: po.receivedAmount,
          ...(closingNote ? { note: closingNote } : {}),
          createdBy: userId,
        },
      });
      // Log: COMPLETED dgn BL number (purchaseTransactionNumber dari create).
      await tx.purchaseTransactionLog.create({
        data: {
          companyId,
          branchId: po.branchId,
          purchaseOrderId: id,
          documentNumber: po.purchaseTransactionNumber,
          documentType: "BL",
          status: "COMPLETED",
          amount: po.receivedAmount,
          createdBy: userId,
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

  async listTransactionLog(
    companyId: string,
    query: ListPurchaseTransactionLogQueryDto,
  ): Promise<PaginatedResponse<PurchaseTransactionLogResponse>> {
    const where: Prisma.PurchaseTransactionLogWhereInput = { companyId };
    if (query.branchId) where.branchId = query.branchId;
    if (query.status) where.status = query.status;
    if (query.documentType) where.documentType = query.documentType;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search, mode: "insensitive" } },
        {
          purchaseOrder: {
            orderNumber: { contains: query.search, mode: "insensitive" },
          },
        },
        {
          purchaseOrder: {
            supplier: {
              name: { contains: query.search, mode: "insensitive" },
            },
          },
        },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findTransactionLogs(
        where,
        (query.page - 1) * query.perPage,
        query.perPage,
      ),
      this.repo.countTransactionLogs(where),
    ]);

    // Enrich branch + user.
    const branchIds = Array.from(
      new Set(rows.map((r) => r.branchId).filter((b): b is string => !!b)),
    );
    const userIds = Array.from(
      new Set(rows.map((r) => r.createdBy).filter((u): u is string => !!u)),
    );
    const [branches, users] = await Promise.all([
      branchIds.length > 0
        ? this.repo.findBranchesByIds(companyId, branchIds)
        : Promise.resolve([] as { id: string; name: string }[]),
      userIds.length > 0
        ? this.repo.findUsersByIds(userIds)
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const branchMap = new Map(branches.map((b) => [b.id, b]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const logs: PurchaseTransactionLogResponse[] = rows.map((r) => ({
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      purchaseOrder: r.purchaseOrder
        ? {
            id: r.purchaseOrder.id,
            orderNumber: r.purchaseOrder.orderNumber,
            purchaseTransactionNumber:
              r.purchaseOrder.purchaseTransactionNumber ?? null,
          }
        : null,
      branchId: r.branchId,
      branch: r.branchId ? (branchMap.get(r.branchId) ?? null) : null,
      documentNumber: r.documentNumber,
      documentType: r.documentType,
      status: r.status,
      amount: r.amount,
      note: r.note,
      createdBy: r.createdBy,
      createdByUser: r.createdBy ? (userMap.get(r.createdBy) ?? null) : null,
      supplier: r.purchaseOrder?.supplier ?? null,
      createdAt: r.createdAt.toISOString(),
    }));

    return paginate(logs, total, query.page, query.perPage);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findByIdForDelete(companyId, id);
    if (!existing)
      throw new NotFoundException("Purchase order tidak ditemukan");
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
    await this.repo.deletePurchaseOrder(id);
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListPurchasesQueryDto,
  ): Prisma.PurchaseOrderWhereInput {
    const { search, status, supplierId, branchId, from, to } = query;
    const where: Prisma.PurchaseOrderWhereInput = tenantWhere(companyId, "direct", "supplier", "branch");
    if (status) {
      const statuses = typeof status === "string" && status.includes(",")
        ? status.split(",").map((s) => s.trim())
        : Array.isArray(status) ? status : [status];
      where.status = statuses.length > 1
        ? { in: statuses as Prisma.EnumPurchaseOrderStatusFilter["in"] }
        : (statuses[0] as Prisma.EnumPurchaseOrderStatusFilter);
    }
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

}

function isOrderNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      if (
        target.includes("orderNumber") ||
        target.includes("purchaseTransactionNumber")
      ) {
        return true;
      }
    }
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
  const variantLabel = it.variant
    ? it.variant.options.map((o) => o.option.name).join(" · ")
    : null;
  // Resolve harga master saat ini sesuai konteks item (paling spesifik dulu).
  let currentMasterPrice: number | null = null;
  if (it.unitId) {
    currentMasterPrice = it.unit?.purchasePrice ?? null;
  } else if (it.variantId) {
    currentMasterPrice =
      it.variant?.purchasePriceOverride ?? it.product?.purchasePrice ?? null;
  } else {
    currentMasterPrice = it.product?.purchasePrice ?? null;
  }
  return {
    id: it.id,
    purchaseOrderId: it.purchaseOrderId,
    productId: it.productId,
    product: it.product
      ? { id: it.product.id, code: it.product.code, name: it.product.name }
      : null,
    unitId: it.unitId ?? null,
    unitName: it.unit?.name ?? null,
    variantId: it.variantId ?? null,
    variantLabel: variantLabel || null,
    quantity: it.quantity,
    receivedQty: it.receivedQty,
    unitPrice: it.unitPrice,
    subtotal: it.subtotal,
    currentMasterPrice,
    previousPurchasePrice:
      (it as unknown as { previousPurchasePrice?: number | null })
        .previousPurchasePrice ?? null,
  };
}

function toPurchaseResponse(po: RawPO): PurchaseOrderResponse {
  return {
    id: po.id,
    orderNumber: po.orderNumber,
    purchaseTransactionNumber: po.purchaseTransactionNumber,
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
    unitPrice: it.unitPrice ?? null,
    previousPurchasePrice: it.previousPurchasePrice ?? null,
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
