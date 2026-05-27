import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { round2 } from "@/common/utils/math";
import { AssertService } from "@/common/assert/assert.service";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RackStockHelperService } from "@/modules/racks/rack-stock-helper.service";
import type {
  ReceivePurchaseDto,
  ReceivePurchaseResponse,
} from "./dto/purchases.dto";
import {
  PurchasesRepository,
  PO_DETAIL_SELECT,
  RECEIPT_SELECT,
} from "./purchases.repository";
import {
  toPurchaseDetailResponse,
  toReceiptResponse,
} from "./purchases.service";

@Injectable()
export class PurchaseReceiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PurchasesRepository,
    private readonly rackStockHelper: RackStockHelperService,
    private readonly assert: AssertService,
  ) {}

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
