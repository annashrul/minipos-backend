import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import type {
  CheckoutDto,
  CheckoutResponse,
  ListTransactionsQueryDto,
  RefundTransactionResponse,
  TransactionDetailResponse,
  TransactionListResponse,
  TransactionResponse,
  TransactionStatsQueryDto,
  TransactionStatsResponse,
  VoidTransactionResponse,
} from "@/contracts";
import { DebtsService } from "../debts/debts.service";
import { PointsService } from "../points/points.service";
import { PrismaService } from "../prisma/prisma.service";
import { RackStockHelperService } from "../racks/rack-stock-helper.service";
import { WhatsappReceiptService } from "../whatsapp-receipt/whatsapp-receipt.service";

const TX_SELECT = {
  id: true,
  invoiceNumber: true,
  invoiceDisplayNumber: true,
  userId: true,
  user: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  customerId: true,
  customer: { select: { id: true, name: true, phone: true } },
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  grandTotal: true,
  paymentMethod: true,
  paymentAmount: true,
  changeAmount: true,
  status: true,
  voidReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
  // Include payments di list response biar UI tabel bisa render badge
  // bank/ewallet (reference) tanpa fetch detail per row.
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      reference: true,
      personLabel: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransactionSelect;

const TX_DETAIL_SELECT = {
  ...TX_SELECT,
  items: {
    select: {
      id: true,
      productId: true,
      productName: true,
      productCode: true,
      quantity: true,
      unitName: true,
      unitPrice: true,
      discount: true,
      subtotal: true,
      promoType: true,
      promoName: true,
      // modifiers stored as JSON: [{groupId, groupName, optionId, optionName, priceAdjustment}].
      // Dipakai untuk display nama varian/modifier di riwayat.
      modifiers: true,
      notes: true,
    },
    orderBy: { createdAt: "asc" },
  },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      reference: true,
      personLabel: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransactionSelect;

type RawTx = Prisma.TransactionGetPayload<{ select: typeof TX_SELECT }>;
type RawTxDetail = Prisma.TransactionGetPayload<{
  select: typeof TX_DETAIL_SELECT;
}>;

import { RealtimeService, EVENTS } from "../realtime/realtime.service";
import { AutoJournalService } from "../auto-journal/auto-journal.service";

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly debts: DebtsService,
    private readonly points: PointsService,
    private readonly realtime: RealtimeService,
    private readonly autoJournal: AutoJournalService,
    private readonly whatsapp: WhatsappReceiptService,
    private readonly rackStockHelper: RackStockHelperService,
  ) {}

  async list(
    companyId: string,
    query: ListTransactionsQueryDto,
  ): Promise<TransactionListResponse> {
    const {
      search,
      status,
      paymentMethod,
      branchId,
      userId,
      customerId,
      from,
      to,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;

    const where: Prisma.TransactionWhereInput = {
      user: { companyId },
    };
    if (search) {
      where.invoiceNumber = { contains: search, mode: "insensitive" };
    }
    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (branchId) where.branchId = branchId;
    if (userId) where.userId = userId;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // OrderBy dinamis dengan whitelist + default fallback createdAt desc.
    const dir: "asc" | "desc" = sortDir ?? "desc";
    let orderBy: Prisma.TransactionOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "user":
          orderBy = { user: { name: dir } };
          break;
        case "invoiceNumber":
        case "createdAt":
        case "grandTotal":
        case "paymentMethod":
        case "status":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.TransactionOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        select: TX_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      transactions: rows.map(toTransactionResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<TransactionDetailResponse> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: TX_DETAIL_SELECT,
    });
    if (!tx) throw new NotFoundException("Transaction not found");
    return toTransactionDetailResponse(tx);
  }

  async checkout(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
    retryCount = 0,
  ): Promise<CheckoutResponse> {
    const branchId = dto.branchId ?? null;
    if (branchId) await this.assertBranch(companyId, branchId);
    if (dto.customerId) await this.assertCustomer(companyId, dto.customerId);

    const [company, branch] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { slug: true, name: true },
      }),
      branchId
        ? this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { code: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    const invoiceNumber = `${normalizeCodePart(
      company?.slug ?? company?.name,
      "COMPANY",
    )}-${normalizeCodePart(branch?.code ?? branch?.name, "MAIN")}-${randomInvoicePart(8)}`;
    const invoiceDisplayNumber = await this.generateDisplayInvoiceNumber(
      companyId,
      new Date(),
    );

    const shouldValidateStock = await this.shouldValidateStock(branchId);

    // Recipe expansion: kalau ada produk yg punya Recipe (mis. menu restoran),
    // decrement-nya menempel ke ingredient (bahan baku), bukan ke produk
    // menu-nya. Bundle tetap pakai logika lama (komponen sudah eksplisit di
    // dto.bundleItems). Untuk produk yg tidak punya recipe, behavior lama
    // (decrement self) berlaku.
    const candidateProductIds = Array.from(
      new Set(
        dto.items
          .filter((it) => !it.productId.startsWith("bundle:"))
          .map((it) => it.productId),
      ),
    );
    const recipes = candidateProductIds.length
      ? await this.prisma.recipe.findMany({
          where: { productId: { in: candidateProductIds } },
          include: {
            ingredients: {
              include: {
                ingredient: { select: { id: true, name: true } },
              },
            },
          },
        })
      : [];
    const recipeMap = new Map<
      string,
      {
        yieldQty: number;
        ingredients: {
          ingredientId: string;
          ingredientName: string;
          quantity: number;
        }[];
      }
    >();
    for (const r of recipes) {
      recipeMap.set(r.productId, {
        yieldQty: r.yieldQty || 1,
        ingredients: r.ingredients.map((i) => ({
          ingredientId: i.ingredientId,
          ingredientName: i.ingredient?.name ?? "(deleted)",
          quantity: i.quantity,
        })),
      });
    }

    // Resolve variant per cart item dari kombinasi modifier optionIds yang
    // dipilih kasir. Variant info dipakai supaya StockMovement mencatat
    // pergerakan per varian (Putih · S, Hitam · L) — bukan agregat product
    // saja. Lookup di sini supaya bisa di-batch sekali per checkout.
    const itemsNeedingVariant = dto.items
      .map((it, idx) => ({ idx, item: it }))
      .filter(({ item }) => (item.modifiers ?? []).some((m) => m.optionId));
    const itemVariantMap = new Map<
      number,
      { variantId: string; variantLabel: string }
    >();
    if (itemsNeedingVariant.length > 0) {
      const productIdsWithMods = Array.from(
        new Set(itemsNeedingVariant.map(({ item }) => item.productId)),
      );
      const variantRows = await this.prisma.productVariant.findMany({
        where: { productId: { in: productIdsWithMods } },
        select: {
          id: true,
          productId: true,
          options: {
            select: {
              optionId: true,
              option: { select: { name: true } },
            },
          },
        },
      });
      const byProduct = new Map<
        string,
        Array<{ id: string; optionIds: Set<string>; label: string }>
      >();
      for (const v of variantRows) {
        const optionIds = new Set(v.options.map((o) => o.optionId));
        const label = v.options.map((o) => o.option.name).join(" · ");
        const arr = byProduct.get(v.productId) ?? [];
        arr.push({ id: v.id, optionIds, label });
        byProduct.set(v.productId, arr);
      }
      for (const { idx, item } of itemsNeedingVariant) {
        const optionIds = (item.modifiers ?? [])
          .map((m) => m.optionId)
          .filter((x): x is string => !!x);
        if (optionIds.length === 0) continue;
        const candidates = byProduct.get(item.productId) ?? [];
        const optSet = new Set(optionIds);
        const matched = candidates.find(
          (c) =>
            c.optionIds.size === optSet.size &&
            Array.from(c.optionIds).every((id) => optSet.has(id)),
        );
        if (matched) {
          itemVariantMap.set(idx, {
            variantId: matched.id,
            variantLabel: matched.label,
          });
        }
      }
    }

    const aggregatedDeductions = aggregateDeductions(
      dto.items,
      recipeMap,
      itemVariantMap,
    );

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          if (shouldValidateStock && aggregatedDeductions.length > 0) {
            const productTotals = new Map<
              string,
              { name: string; quantity: number }
            >();
            for (const d of aggregatedDeductions) {
              const prev = productTotals.get(d.productId);
              productTotals.set(d.productId, {
                name: prev?.name ?? d.productName,
                quantity: (prev?.quantity ?? 0) + d.quantity,
              });
            }
            const productIds = Array.from(productTotals.keys());
            if (branchId) {
              const stocks = await tx.branchStock.findMany({
                where: { branchId, productId: { in: productIds } },
                select: { productId: true, quantity: true },
              });
              const stockMap = new Map(
                stocks.map((s) => [s.productId, s.quantity]),
              );
              for (const [pid, total] of productTotals) {
                const available = stockMap.get(pid) ?? 0;
                if (available < total.quantity) {
                  throw new BadRequestException(
                    `Stok ${total.name} tidak mencukupi di cabang ini (sisa: ${available})`,
                  );
                }
              }
            } else {
              const products = await tx.product.findMany({
                where: { id: { in: productIds }, companyId },
                select: { id: true, name: true, stock: true },
              });
              const stockMap = new Map(products.map((p) => [p.id, p]));
              for (const [pid, total] of productTotals) {
                const p = stockMap.get(pid);
                if (!p) {
                  throw new NotFoundException(
                    `Produk ${total.name} tidak ditemukan`,
                  );
                }
                if (p.stock < total.quantity) {
                  throw new BadRequestException(
                    `Stok ${total.name} tidak mencukupi (sisa: ${p.stock})`,
                  );
                }
              }
            }
          }

          const paymentsData =
            dto.payments && dto.payments.length > 0
              ? dto.payments
              : [{ method: dto.paymentMethod, amount: dto.paymentAmount }];
          // Split Bill detection: kalau ada minimal 1 payment row dengan
          // personLabel, set paymentMethod transaksi ke SPLIT_BILL terlepas
          // dari method per orang. Detail per orang tetap di payments[].
          const isSplitBill = paymentsData.some(
            (p) => "personLabel" in p && p.personLabel,
          );
          const primaryMethod: import("@prisma/client").PaymentMethod = isSplitBill
            ? "SPLIT_BILL"
            : paymentsData.reduce((a, b) => (a.amount >= b.amount ? a : b))
                .method;
          const totalPaid = paymentsData.reduce((s, p) => s + p.amount, 0);

          const newTx = await tx.transaction.create({
            data: {
              invoiceNumber,
              invoiceDisplayNumber,
              companyId,
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
                    ...(item.promoType ? { promoType: item.promoType } : {}),
                    ...(item.promoName ? { promoName: item.promoName } : {}),
                  };
                }),
              },
              payments: {
                create: paymentsData.map((p) => ({
                  method: p.method,
                  amount: p.amount,
                  reference: ("reference" in p && p.reference) || null,
                  personLabel:
                    ("personLabel" in p && p.personLabel) || null,
                })),
              },
            },
            select: { id: true, invoiceNumber: true, invoiceDisplayNumber: true },
          });

          if (dto.promoIds && dto.promoIds.length > 0) {
            await tx.promotion.updateMany({
              where: { id: { in: Array.from(new Set(dto.promoIds)) } },
              data: { usageCount: { increment: 1 } },
            });
          }

          // Sequential — tidak Promise.all — supaya balanceAfter per movement
          // konsisten urutan & menghindari race pada same productId.
          for (const d of aggregatedDeductions) {
            // Stock di schema masih Int — recipe expansion bisa menghasilkan
            // pecahan (mis. yield=4, 1 porsi → ¼ recipe). Bulatkan ke atas
            // supaya tidak under-deduct (lebih aman over-deduct sedikit
            // daripada kelebihan stok semu).
            const qtyInt = Math.ceil(d.quantity);
            if (qtyInt <= 0) continue;

            const movementType =
              d.source === "RECIPE_DEDUCT" ? "RECIPE_DEDUCT" : "SALE";
            // Note & refNumber pakai display number (readable per company per
            // hari). invoiceNumber global tetap dipakai sbg `reference` lama
            // untuk backward-compat dengan filter/search yang sudah ada.
            const displayRef = invoiceDisplayNumber || invoiceNumber;
            const note =
              d.source === "RECIPE_DEDUCT"
                ? `Pakai bahan untuk ${displayRef}`
                : `Penjualan ${displayRef}`;

            if (branchId) {
              const updated = await tx.branchStock.update({
                where: {
                  branchId_productId: { branchId, productId: d.productId },
                },
                data: { quantity: { decrement: qtyInt } },
                select: { quantity: true },
              });
              // Phase 2B: kurangi RackStock kalau produk ini di-track per rak.
              // FIFO dari rak default → rak lain. No-op kalau produk tidak
              // punya entry RackStock (legacy / non-tracked).
              await this.rackStockHelper.deductFromRacks(tx, {
                branchId,
                productId: d.productId,
                qty: qtyInt,
                refType: "transaction",
                refId: newTx.id,
                userId: userId ?? null,
                notes: `Penjualan ${displayRef}`,
                movementType:
                  movementType === "RECIPE_DEDUCT" ? "RECIPE_DEDUCT" : "SALE",
              });
              const skuRow = await tx.productBranchSku.findFirst({
                where: {
                  productId: d.productId,
                  branchId,
                  variantId: d.variantId ?? null,
                  unitId: null,
                },
                select: { id: true, stock: true },
              });
              if (skuRow) {
                await tx.productBranchSku.update({
                  where: { id: skuRow.id },
                  data: { stock: Math.max(skuRow.stock - qtyInt, 0) },
                });
              }
              await tx.stockMovement.create({
                data: {
                  productId: d.productId,
                  branchId,
                  variantId: d.variantId,
                  variantLabel: d.variantLabel,
                  companyId,
                  type: movementType,
                  quantity: qtyInt,
                  direction: "OUT",
                  balanceAfter: updated.quantity,
                  refType: "transaction",
                  refId: newTx.id,
                  refNumber: displayRef,
                  note,
                  reference: invoiceNumber,
                  createdBy: userId,
                },
              });
            } else {
              await tx.product.update({
                where: { id: d.productId },
                data: { stock: { decrement: qtyInt } },
              });
              await tx.stockMovement.create({
                data: {
                  productId: d.productId,
                  branchId: null,
                  variantId: d.variantId,
                  variantLabel: d.variantLabel,
                  companyId,
                  type: movementType,
                  quantity: qtyInt,
                  direction: "OUT",
                  refType: "transaction",
                  refId: newTx.id,
                  refNumber: displayRef,
                  note,
                  reference: invoiceNumber,
                  createdBy: userId,
                },
              });
            }
          }

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
              invoiceNumber:
                newTx.invoiceDisplayNumber || newTx.invoiceNumber,
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
                invoiceNumber:
                  newTx.invoiceDisplayNumber || newTx.invoiceNumber,
              });
              pointsRedeemed = dto.redeemPoints;
            }
            const earn = await this.points.earnFromTransaction(tx, {
              customerId: dto.customerId,
              amount: dto.grandTotal,
              invoiceNumber:
                newTx.invoiceDisplayNumber || newTx.invoiceNumber,
            });
            pointsEarned = earn.earned;
          }

          return { ...newTx, pointsEarned, pointsRedeemed };
        },
        { maxWait: 10000, timeout: 15000 },
      );

      const emitBranch = dto.branchId ?? undefined;
      this.realtime.emit(
        EVENTS.TRANSACTION_CREATED,
        {
          transactionId: created.id,
          invoiceNumber: created.invoiceNumber,
        },
        emitBranch,
      );
      this.realtime.emit(EVENTS.STOCK_UPDATED, {}, emitBranch);
      this.realtime.emit(EVENTS.DASHBOARD_REFRESH, {}, emitBranch);

      // Auto-post journal for every successful sales transaction.
      // Do not block checkout flow if accounting setup is incomplete.
      try {
        await this.autoJournal.create(companyId, userId, {
          referenceType: "TRANSACTION",
          referenceId: created.id,
          ...(branchId ? { branchId } : {}),
        });
      } catch (error) {
        this.logger.warn(
          `Auto journal gagal untuk transaksi ${created.invoiceNumber}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }

      // Auto-kirim struk via WhatsApp ke nomor customer kalau ada.
      // Fire-and-forget — jangan block checkout response, jangan gagalkan
      // transaksi kalau WA belum konek / nomor invalid.
      // Gated by setting `pos.autoSendWhatsappReceipt` (per-cabang dengan
      // fallback ke company-level). Default true.
      if (dto.customerId) {
        const autoSendEnabled = await this.shouldAutoSendWhatsapp(branchId);
        if (autoSendEnabled) {
          this.logger.log(
            `[wa-receipt] dispatch invoice=${created.invoiceNumber} customerId=${dto.customerId}`,
          );
          void this.dispatchWhatsappReceipt(
            companyId,
            dto.customerId,
            created.id,
            created.invoiceNumber,
          );
        } else {
          this.logger.log(
            `[wa-receipt] skip invoice=${created.invoiceNumber} reason=auto-send-disabled`,
          );
        }
      } else {
        this.logger.log(
          `[wa-receipt] skip invoice=${created.invoiceNumber} reason=no-customerId`,
        );
      }

      // Edit-mode: kalau ada replaceTransactionId, source di-handle setelah
      // create new sukses (di luar prisma.$transaction utama). Behavior beda
      // berdasarkan status source:
      //   - DRAFT     → cukup delete (stok belum dipotong, ledger belum kena)
      //   - COMPLETED → void supaya stok di-restore (existing flow)
      // Setelah source disposed, transfer invoiceNumber + createdAt source ke
      // tx baru supaya secara user-facing seperti "edit in-place" (no/tanggal
      // tidak berubah). Source yg di-void di-rename invoice-nya supaya tidak
      // bentrok dgn unique constraint.
      // Kalau gagal, log warning — transaksi baru sudah jadi.
      let finalInvoiceNumber = created.invoiceNumber;
      let finalInvoiceDisplayNumber = created.invoiceDisplayNumber;
      if (dto.replaceTransactionId) {
        try {
          const src = await this.prisma.transaction.findFirst({
            where: { id: dto.replaceTransactionId, user: { companyId } },
            select: {
              id: true,
              status: true,
              invoiceNumber: true,
              invoiceDisplayNumber: true,
              createdAt: true,
            },
          });
          if (!src) {
            this.logger.warn(
              `[edit-tx] source ${dto.replaceTransactionId} tidak ditemukan`,
            );
          } else {
            // Capture identitas source utk transfer ke tx baru.
            const preserveInvoice = src.invoiceNumber;
            const preserveDisplay = src.invoiceDisplayNumber;
            const preserveCreatedAt = src.createdAt;

            if (src.status === "DRAFT") {
              // Draft → langsung delete (free up invoice + tidak ada ledger).
              await this.prisma.transaction.delete({ where: { id: src.id } });
            } else {
              // COMPLETED → rename invoice source dulu (supaya unique
              // constraint tidak collide), lalu void.
              const renamedInvoice = `${src.invoiceNumber}-EDIT-${Date.now()}`;
              const renamedDisplay = src.invoiceDisplayNumber
                ? `${src.invoiceDisplayNumber}-EDIT`
                : null;
              await this.prisma.transaction.update({
                where: { id: src.id },
                data: {
                  invoiceNumber: renamedInvoice,
                  invoiceDisplayNumber: renamedDisplay,
                },
              });
              await this.voidTransaction(
                companyId,
                userId,
                src.id,
                `Diedit → diganti dengan ${preserveDisplay ?? preserveInvoice}`,
              );
            }

            // Transfer identitas source ke tx baru.
            await this.prisma.transaction.update({
              where: { id: created.id },
              data: {
                invoiceNumber: preserveInvoice,
                invoiceDisplayNumber: preserveDisplay,
                createdAt: preserveCreatedAt,
              },
            });
            finalInvoiceNumber = preserveInvoice;
            finalInvoiceDisplayNumber = preserveDisplay;
          }
        } catch (err) {
          this.logger.warn(
            `[edit-tx] gagal proses source ${dto.replaceTransactionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return {
        id: created.id,
        invoiceNumber: finalInvoiceNumber,
        invoiceDisplayNumber: finalInvoiceDisplayNumber ?? null,
        pointsEarned: created.pointsEarned,
        pointsRedeemed: created.pointsRedeemed,
      };
    } catch (err) {
      if (isInvoiceConflict(err) && retryCount < 3) {
        return this.checkout(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  /**
   * Async dispatch struk digital ke WA. Skip diam-diam kalau:
   *  - customer tidak punya phone
   *  - sesi WhatsApp belum connect
   *  - phone = nomor sendiri (self-send rejected by sendText)
   * Error tidak di-throw — hanya di-log, agar tidak mengganggu flow checkout.
   */
  private async dispatchWhatsappReceipt(
    companyId: string,
    customerId: string,
    transactionId: string,
    invoiceNumber: string,
  ): Promise<void> {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, companyId },
        select: { phone: true, name: true },
      });
      const phone = customer?.phone?.trim();
      if (!phone) {
        this.logger.log(
          `[wa-receipt] skip invoice=${invoiceNumber} reason=customer-no-phone customer=${customer?.name ?? "-"}`,
        );
        return;
      }
      this.logger.log(
        `[wa-receipt] sending invoice=${invoiceNumber} to=${customer?.name ?? "-"} (${phone})`,
      );
      await this.whatsapp.sendReceipt(companyId, transactionId, phone);
      this.logger.log(
        `[wa-receipt] sent invoice=${invoiceNumber} to=${customer?.name ?? "-"} (${phone})`,
      );
    } catch (err) {
      this.logger.warn(
        `[wa-receipt] FAILED invoice=${invoiceNumber}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }

  private async assertCustomer(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
  }

  async voidTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<VoidTransactionResponse> {
    return this.changeStatusWithRestore(
      companyId,
      userId,
      id,
      reason,
      "VOIDED",
    ) as Promise<VoidTransactionResponse>;
  }

  async refundTransaction(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
  ): Promise<RefundTransactionResponse> {
    return this.changeStatusWithRestore(
      companyId,
      userId,
      id,
      reason,
      "REFUNDED",
    ) as Promise<RefundTransactionResponse>;
  }

  /**
   * Simpan transaksi sebagai DRAFT — TANPA potong stok, TANPA bikin payment,
   * TANPA bikin StockMovement. Cocok untuk kasir yang ingin "tahan" cart
   * lalu lanjutin nanti / di-edit dulu sebelum bayar. Draft akan muncul di
   * list transaksi dengan status=DRAFT, bisa di-edit (load ke POS) atau
   * di-batalkan.
   */
  async createDraft(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
  ): Promise<{
    id: string;
    invoiceNumber: string;
    invoiceDisplayNumber: string | null;
  }> {
    if (dto.items.length === 0) {
      throw new BadRequestException("Cart kosong, tidak bisa simpan draft");
    }
    const branchId = dto.branchId ?? null;
    if (branchId) await this.assertBranch(companyId, branchId);
    if (dto.customerId) await this.assertCustomer(companyId, dto.customerId);
    const [company, branch] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { slug: true, name: true },
      }),
      branchId
        ? this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { code: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    const invoiceNumber = `${normalizeCodePart(
      company?.slug ?? company?.name,
      "COMPANY",
    )}-${normalizeCodePart(branch?.code ?? branch?.name, "MAIN")}-${randomInvoicePart(8)}`;
    const invoiceDisplayNumber = await this.generateDisplayInvoiceNumber(
      companyId,
      new Date(),
    );

    const tx = await this.prisma.transaction.create({
      data: {
        invoiceNumber,
        invoiceDisplayNumber,
        userId,
        branchId,
        customerId: dto.customerId ?? null,
        status: "DRAFT",
        subtotal: dto.subtotal,
        discountAmount: dto.discountAmount ?? 0,
        taxAmount: dto.taxAmount ?? 0,
        grandTotal: dto.grandTotal,
        paymentMethod: dto.paymentMethod,
        // Draft belum ada pembayaran nyata
        paymentAmount: 0,
        changeAmount: 0,
        notes: dto.notes ?? null,
        promoApplied: dto.promoApplied ?? null,
        items: {
          create: dto.items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            productCode: it.productCode,
            quantity: it.quantity,
            unitName: it.unitName ?? null,
            conversionQty: it.conversionQty ?? null,
            unitPrice: it.unitPrice,
            discount: it.discount ?? 0,
            subtotal: it.subtotal,
            ...(Array.isArray(it.modifiers) && it.modifiers.length > 0
              ? { modifiers: it.modifiers as unknown as Prisma.InputJsonValue }
              : {}),
            notes: it.notes ?? null,
            promoType: it.promoType ?? null,
            promoName: it.promoName ?? null,
          })),
        },
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDisplayNumber: true,
      },
    });
    return {
      id: tx.id,
      invoiceNumber: tx.invoiceNumber,
      invoiceDisplayNumber: tx.invoiceDisplayNumber ?? null,
    };
  }

  /**
   * Hapus draft transaksi. Hanya boleh untuk status=DRAFT (transaksi
   * COMPLETED tidak bisa di-delete, harus void/refund).
   */
  async deleteDraft(companyId: string, id: string): Promise<{ id: string }> {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: { id: true, status: true },
    });
    if (!tx) throw new NotFoundException("Draft tidak ditemukan");
    if (tx.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya draft yang bisa dihapus. Pakai void/refund untuk transaksi selesai.",
      );
    }
    await this.prisma.transaction.delete({ where: { id } });
    return { id };
  }

  /**
   * Duplikat transaksi: load source → build CheckoutDto → call checkout().
   * Hasil: transaksi baru dengan invoice number baru, items + payment + harga
   * sama persis, tapi promo & redeem points di-skip (kontekstual ke transaksi
   * lama). Stok divalidasi ulang oleh checkout() — kalau habis, error 400.
   */
  async duplicate(
    companyId: string,
    userId: string,
    sourceId: string,
  ): Promise<CheckoutResponse> {
    const source = await this.prisma.transaction.findFirst({
      where: { id: sourceId, user: { companyId } },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            productId: true,
            productName: true,
            productCode: true,
            quantity: true,
            unitName: true,
            conversionQty: true,
            unitPrice: true,
            discount: true,
            subtotal: true,
            modifiers: true,
            notes: true,
            promoType: true,
          },
        },
        payments: {
          select: {
            method: true,
            amount: true,
            reference: true,
            personLabel: true,
          },
        },
      },
    });
    if (!source)
      throw new NotFoundException("Transaksi sumber tidak ditemukan");
    if (source.status !== "COMPLETED") {
      throw new BadRequestException(
        "Hanya transaksi COMPLETED yang bisa di-duplikat",
      );
    }
    // Filter item promo (gift, tebus murah) — promo bersifat kontekstual,
    // harus di-trigger ulang. Item DISCOUNT_PERCENT/AMOUNT di-keep karena
    // discount sudah ke-snapshot di field `discount` dan `subtotal`.
    const cleanItems = source.items.filter(
      (it) => it.promoType !== "GIFT" && it.promoType !== "TEBUS",
    );
    if (cleanItems.length === 0) {
      throw new BadRequestException("Tidak ada item yang bisa di-duplikat");
    }
    // Recompute totals supaya konsisten setelah filter promo items.
    const subtotal = cleanItems.reduce(
      (sum, it) => sum + it.unitPrice * it.quantity,
      0,
    );
    const discountAmount = cleanItems.reduce(
      (sum, it) => sum + (it.discount ?? 0),
      0,
    );
    const grandTotal = subtotal - discountAmount + (source.taxAmount ?? 0);
    const dto: CheckoutDto = {
      items: cleanItems.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        productCode: it.productCode,
        quantity: it.quantity,
        unitName: it.unitName ?? "PCS",
        conversionQty: it.conversionQty ?? 1,
        unitPrice: it.unitPrice,
        discount: it.discount ?? 0,
        subtotal: it.subtotal,
        ...(Array.isArray(it.modifiers) && it.modifiers.length > 0
          ? {
              modifiers: it.modifiers as unknown as CheckoutDto["items"][number]["modifiers"],
            }
          : {}),
        ...(it.notes ? { notes: it.notes } : {}),
      })),
      subtotal,
      discountAmount,
      taxAmount: source.taxAmount ?? 0,
      grandTotal,
      paymentMethod: source.paymentMethod as CheckoutDto["paymentMethod"],
      // Bayar = grandTotal supaya tidak buat utang piutang baru. Kalau memang
      // mau cicilan ulang, user bisa ubah lewat POS biasa, bukan duplikat.
      paymentAmount: grandTotal,
      changeAmount: 0,
      // Kalau source pakai split bill / multi payment, salin sesuai porsi
      // yang sama tapi clamp totalnya = grandTotal yg baru.
      ...(source.payments.length > 0
        ? {
            payments: source.payments.map((p, idx) => ({
              method: p.method as CheckoutDto["paymentMethod"],
              // Split rata kalau totalnya berbeda — fallback adil utk simple case.
              amount:
                idx === source.payments.length - 1
                  ? grandTotal -
                    source.payments
                      .slice(0, -1)
                      .reduce(
                        (s, x) =>
                          s +
                          Math.round(
                            (x.amount / (source.grandTotal || 1)) * grandTotal,
                          ),
                        0,
                      )
                  : Math.round(
                      (p.amount / (source.grandTotal || 1)) * grandTotal,
                    ),
              reference: p.reference ?? null,
              personLabel: p.personLabel ?? null,
            })),
          }
        : {}),
      ...(source.customerId ? { customerId: source.customerId } : {}),
      ...(source.branchId ? { branchId: source.branchId } : {}),
      // Skip promo & redeem points — kontekstual.
      promoApplied: null,
      promoIds: [],
      redeemPoints: 0,
      notes: `Duplikat dari ${source.invoiceDisplayNumber ?? source.invoiceNumber}`,
    };
    return this.checkout(companyId, userId, dto);
  }

  private async changeStatusWithRestore(
    companyId: string,
    userId: string,
    id: string,
    reason: string,
    target: "VOIDED" | "REFUNDED",
  ): Promise<VoidTransactionResponse | RefundTransactionResponse> {
    const noun = target === "VOIDED" ? "Void" : "Refund";

    const existing = await this.prisma.transaction.findFirst({
      where: { id, user: { companyId } },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Transaction not found");

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!transaction) throw new NotFoundException("Transaction not found");
      if (transaction.status !== "COMPLETED") {
        throw new BadRequestException(
          `Hanya transaksi COMPLETED yang bisa di-${noun.toLowerCase()}`,
        );
      }

      if (transaction.branchId) {
        await tx.$executeRaw`
          select
            set_config('app.stock_note', ${`${noun} transaksi ${transaction.invoiceNumber}`}, true),
            set_config('app.stock_reference', ${transaction.invoiceNumber}, true)
        `;
      }

      await Promise.all(
        transaction.items.map(async (item) => {
          const restoreQty =
            item.baseQty ?? item.quantity * (item.conversionQty ?? 1);
          if (transaction.branchId) {
            await tx.branchStock.upsert({
              where: {
                branchId_productId: {
                  branchId: transaction.branchId,
                  productId: item.productId,
                },
              },
              create: {
                branchId: transaction.branchId,
                productId: item.productId,
                quantity: restoreQty,
              },
              update: {
                quantity: { increment: restoreQty },
              },
            });
            // Phase 2B: restore RackStock ke rak default produk (kalau ada).
            // Void/refund tidak tahu rak asal pengambilan, jadi balikin ke
            // default rak — admin bisa adjust manual kalau perlu.
            await this.rackStockHelper.addToRack(tx, {
              branchId: transaction.branchId,
              productId: item.productId,
              qty: restoreQty,
              refType: "transaction",
              refId: transaction.id,
              userId: userId ?? null,
              notes: `${noun} transaksi ${transaction.invoiceNumber}`,
              movementType: target === "VOIDED" ? "VOID_RESTORE" : "REFUND_IN",
            });
            return;
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: restoreQty } },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              branchId: null,
              type: "IN",
              quantity: restoreQty,
              note: `${noun} transaksi ${transaction.invoiceNumber}`,
              reference: transaction.invoiceNumber,
            },
          });
        }),
      );

      const updated = await tx.transaction.update({
        where: { id },
        data: { status: target, voidReason: reason },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          branchId: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          branchId: transaction.branchId,
          action: target === "VOIDED" ? "VOID" : "REFUND",
          entity: "Transaction",
          entityId: id,
          details: `${noun} ${transaction.invoiceNumber}: ${reason}`,
        },
      });

      this.realtime.emit(
        target === "VOIDED" ? EVENTS.TRANSACTION_VOIDED : EVENTS.TRANSACTION_REFUNDED,
        {
          transactionId: updated.id,
          invoiceNumber: updated.invoiceNumber,
        },
        updated.branchId ?? undefined,
      );
      this.realtime.emit(EVENTS.STOCK_UPDATED, {}, updated.branchId ?? undefined);
      this.realtime.emit(EVENTS.DASHBOARD_REFRESH, {}, updated.branchId ?? undefined);

      return {
        id: updated.id,
        invoiceNumber: updated.invoiceNumber,
        status: updated.status as "VOIDED" | "REFUNDED",
        branchId: updated.branchId,
      } as VoidTransactionResponse | RefundTransactionResponse;
    });
  }

  async stats(
    companyId: string,
    query: TransactionStatsQueryDto,
  ): Promise<TransactionStatsResponse> {
    const { branchId, from, to } = query;
    const baseWhere: Prisma.TransactionWhereInput = { user: { companyId } };
    if (branchId) baseWhere.branchId = branchId;
    if (from || to) {
      baseWhere.createdAt = {};
      if (from) baseWhere.createdAt.gte = new Date(from);
      if (to) baseWhere.createdAt.lte = new Date(to);
    }

    const completedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "COMPLETED",
    };
    const refundedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "REFUNDED",
    };
    const voidedWhere: Prisma.TransactionWhereInput = {
      ...baseWhere,
      status: "VOIDED",
    };

    const [completedAgg, refundedAgg, voidedAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: completedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: refundedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      this.prisma.transaction.aggregate({
        where: voidedWhere,
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
    ]);

    const totalSales = completedAgg._sum.grandTotal ?? 0;
    const transactionCount = completedAgg._count._all;
    const avgTransaction =
      transactionCount > 0 ? totalSales / transactionCount : 0;
    const totalRefund = refundedAgg._count._all;
    const totalVoid = voidedAgg._count._all;

    return {
      totalSales,
      transactionCount,
      avgTransaction,
      totalRefund,
      totalVoid,
    };
  }

  /**
   * Generate `invoiceDisplayNumber` per (companyId, date) sequential.
   * Format: "INV-DDMMYYYY-NNNNN" (5-digit zero-padded).
   *
   * Cara kerja:
   *   - Cari max NNNNN di transaksi dgn companyId & tanggal yang sama
   *   - Tambah 1, pad jadi 5 digit
   *   - Race protection ditangani retry on P2002 di catch block checkout
   *     (sama dengan invoiceNumber lama).
   */
  private async generateDisplayInvoiceNumber(
    companyId: string,
    date: Date,
  ): Promise<string> {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const prefix = `INV-${dd}${mm}${yyyy}-`;

    const last = await this.prisma.transaction.findFirst({
      where: {
        companyId,
        invoiceDisplayNumber: { startsWith: prefix },
      },
      orderBy: { invoiceDisplayNumber: "desc" },
      select: { invoiceDisplayNumber: true },
    });

    let nextSeq = 1;
    if (last?.invoiceDisplayNumber) {
      const tail = last.invoiceDisplayNumber.slice(prefix.length);
      const parsed = parseInt(tail, 10);
      if (!Number.isNaN(parsed)) nextSeq = parsed + 1;
    }

    return `${prefix}${String(nextSeq).padStart(5, "0")}`;
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

  private async shouldAutoSendWhatsapp(
    branchId: string | null,
  ): Promise<boolean> {
    const setting = branchId
      ? await this.prisma.setting.findFirst({
          where: { key: "pos.autoSendWhatsappReceipt", branchId },
        })
      : null;
    const fallback = setting
      ? null
      : await this.prisma.setting.findFirst({
          where: { key: "pos.autoSendWhatsappReceipt", branchId: null },
        });
    const value = (setting ?? fallback)?.value;
    // Default true (preserve existing behavior). Hanya off kalau eksplisit "false".
    return value !== "false";
  }
}

function toTransactionResponse(t: RawTx): TransactionResponse {
  return {
    id: t.id,
    invoiceNumber: t.invoiceNumber,
    invoiceDisplayNumber: t.invoiceDisplayNumber ?? null,
    userId: t.userId,
    user: t.user ? { id: t.user.id, name: t.user.name } : null,
    branchId: t.branchId,
    branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
    customerId: t.customerId,
    customer: t.customer ? { id: t.customer.id, name: t.customer.name, phone: t.customer.phone } : null,
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxAmount: t.taxAmount,
    grandTotal: t.grandTotal,
    paymentMethod: t.paymentMethod,
    paymentAmount: t.paymentAmount,
    changeAmount: t.changeAmount,
    status: t.status,
    voidReason: t.voidReason,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    itemCount: t._count.items,
    payments: t.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      personLabel: p.personLabel,
    })),
  };
}

function toTransactionDetailResponse(
  t: RawTxDetail,
): TransactionDetailResponse {
  return {
    ...toTransactionResponse(t),
    items: t.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: i.unitPrice,
      discount: i.discount,
      subtotal: i.subtotal,
      promoType: i.promoType,
      promoName: i.promoName,
      // modifiers JSON di DB: array {groupId, groupName, optionId, optionName, priceAdjustment}.
      // Cast as known shape buat display di FE riwayat.
      modifiers: (i.modifiers as Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceAdjustment: number;
      }> | null) ?? null,
      notes: i.notes ?? null,
    })),
    payments: t.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      personLabel: p.personLabel,
    })),
  };
}

type DeductionSource = "SALE" | "RECIPE_DEDUCT";

function aggregateDeductions(
  items: CheckoutDto["items"],
  recipeMap?: Map<
    string,
    {
      yieldQty: number;
      ingredients: {
        ingredientId: string;
        ingredientName: string;
        quantity: number;
      }[];
    }
  >,
  itemVariantMap?: Map<number, { variantId: string; variantLabel: string }>,
): Array<{
  productId: string;
  productName: string;
  quantity: number;
  unitName: string | null;
  conversionQty: number;
  source: DeductionSource;
  variantId: string | null;
  variantLabel: string | null;
}> {
  // Key: `${productId}|${variantId}|${source}` supaya kartu stok bisa
  // breakdown per varian (Putih · S, Hitam · L) — beda tipe juga dipisah
  // (sale vs recipe deduct) supaya tampil sebagai row terpisah di riwayat.
  const map = new Map<
    string,
    {
      productId: string;
      productName: string;
      quantity: number;
      unitName: string | null;
      conversionQty: number;
      source: DeductionSource;
      variantId: string | null;
      variantLabel: string | null;
    }
  >();
  const addDeduction = (
    productId: string,
    productName: string,
    qty: number,
    unitName: string | null,
    conversionQty: number,
    source: DeductionSource,
    variantId: string | null,
    variantLabel: string | null,
  ) => {
    const normalizedUnit = unitName?.trim() || "";
    const key = `${productId}|${normalizedUnit}|${conversionQty}|${variantId ?? ""}|${source}`;
    const prev = map.get(key);
    map.set(key, {
      productId,
      productName: prev?.productName ?? productName,
      quantity: (prev?.quantity ?? 0) + qty,
      unitName: unitName,
      conversionQty,
      source,
      variantId,
      variantLabel,
    });
  };

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    const variantInfo = itemVariantMap?.get(idx) ?? null;
    const variantId = variantInfo?.variantId ?? null;
    const variantLabel = variantInfo?.variantLabel ?? null;

    if (item.productId.startsWith("bundle:") && item.bundleItems) {
      // Bundle: expand komponen explicit. Recipe di komponen tidak di-expand
      // lagi (asumsi: bundle restaurant biasanya tidak punya recipe nested,
      // dan kalau pun ada, owner bisa pakai 1 dari 2 mekanisme — bukan dual).
      // Komponen bundle tidak punya variant di payload — selalu null.
      for (const comp of item.bundleItems) {
        addDeduction(
          comp.productId,
          comp.productName,
          comp.quantity * item.quantity,
          null,
          1,
          "SALE",
          null,
          null,
        );
      }
      continue;
    }

    const totalQty = item.quantity * (item.conversionQty ?? 1);
    const recipe = recipeMap?.get(item.productId);
    if (recipe && recipe.ingredients.length > 0) {
      // Menu dgn recipe: decrement ingredient sesuai (qty * porsi / yieldQty).
      // Tidak men-decrement stok menu itu sendiri — menu di restoran umumnya
      // tidak di-track stoknya secara langsung. Ingredient juga tidak punya
      // variant (variant melekat di menu, bukan bahan).
      const yieldQty = recipe.yieldQty || 1;
      for (const ing of recipe.ingredients) {
        const deduct = (ing.quantity * totalQty) / yieldQty;
        addDeduction(
          ing.ingredientId,
          ing.ingredientName,
          deduct,
          null,
          1,
          "RECIPE_DEDUCT",
          null,
          null,
        );
      }
      continue;
    }

    // Default: decrement self (produk retail biasa). Pakai variant kalau
    // item resolve ke ProductVariant — supaya kartu stok per varian.
    addDeduction(
      item.productId,
      item.productName,
      totalQty,
      item.unitName ?? null,
      item.conversionQty ?? 1,
      "SALE",
      variantId,
      variantLabel,
    );
  }
  return Array.from(map.values());
}

function normalizeCodePart(
  value: string | null | undefined,
  fallback: string,
): string {
  const clean = (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return clean || fallback;
}

function randomInvoicePart(length = 8): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .toUpperCase()
    .slice(0, length);
}

function isInvoiceConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target)) {
      if (target.includes("invoiceNumber")) return true;
      if (target.includes("invoiceDisplayNumber")) return true;
    }
  }
  return false;
}
