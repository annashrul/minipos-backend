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
  customer: { select: { id: true, name: true } },
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

    const aggregatedDeductions = aggregateDeductions(dto.items, recipeMap);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          if (shouldValidateStock && aggregatedDeductions.length > 0) {
            const productIds = aggregatedDeductions.map((d) => d.productId);
            if (branchId) {
              const stocks = await tx.branchStock.findMany({
                where: { branchId, productId: { in: productIds } },
                select: { productId: true, quantity: true },
              });
              const stockMap = new Map(
                stocks.map((s) => [s.productId, s.quantity]),
              );
              for (const d of aggregatedDeductions) {
                const available = stockMap.get(d.productId) ?? 0;
                if (available < d.quantity) {
                  throw new BadRequestException(
                    `Stok ${d.productName} tidak mencukupi di cabang ini (sisa: ${available})`,
                  );
                }
              }
            } else {
              const products = await tx.product.findMany({
                where: { id: { in: productIds }, companyId },
                select: { id: true, name: true, stock: true },
              });
              const stockMap = new Map(products.map((p) => [p.id, p]));
              for (const d of aggregatedDeductions) {
                const p = stockMap.get(d.productId);
                if (!p) {
                  throw new NotFoundException(
                    `Produk ${d.productName} tidak ditemukan`,
                  );
                }
                if (p.stock < d.quantity) {
                  throw new BadRequestException(
                    `Stok ${d.productName} tidak mencukupi (sisa: ${p.stock})`,
                  );
                }
              }
            }
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
              await tx.stockMovement.create({
                data: {
                  productId: d.productId,
                  branchId,
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
      if (dto.customerId) {
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
          `[wa-receipt] skip invoice=${created.invoiceNumber} reason=no-customerId`,
        );
      }

      return {
        id: created.id,
        invoiceNumber: created.invoiceNumber,
        invoiceDisplayNumber: created.invoiceDisplayNumber ?? null,
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
            return tx.branchStock.upsert({
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
    customer: t.customer ? { id: t.customer.id, name: t.customer.name } : null,
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
): Array<{
  productId: string;
  productName: string;
  quantity: number;
  source: DeductionSource;
}> {
  // Key: `${productId}|${source}` supaya bisa beda type di kartu stok
  // jika produk yg sama muncul sbg direct sale & ingredient di trx yg sama.
  const map = new Map<
    string,
    {
      productId: string;
      productName: string;
      quantity: number;
      source: DeductionSource;
    }
  >();
  const addDeduction = (
    productId: string,
    productName: string,
    qty: number,
    source: DeductionSource,
  ) => {
    const key = `${productId}|${source}`;
    const prev = map.get(key);
    map.set(key, {
      productId,
      productName: prev?.productName ?? productName,
      quantity: (prev?.quantity ?? 0) + qty,
      source,
    });
  };

  for (const item of items) {
    if (item.productId.startsWith("bundle:") && item.bundleItems) {
      // Bundle: expand komponen explicit. Recipe di komponen tidak di-expand
      // lagi (asumsi: bundle restaurant biasanya tidak punya recipe nested,
      // dan kalau pun ada, owner bisa pakai 1 dari 2 mekanisme — bukan dual).
      for (const comp of item.bundleItems) {
        addDeduction(
          comp.productId,
          comp.productName,
          comp.quantity * item.quantity,
          "SALE",
        );
      }
      continue;
    }

    const totalQty = item.quantity * (item.conversionQty ?? 1);
    const recipe = recipeMap?.get(item.productId);
    if (recipe && recipe.ingredients.length > 0) {
      // Menu dgn recipe: decrement ingredient sesuai (qty * porsi / yieldQty).
      // Tidak men-decrement stok menu itu sendiri — menu di restoran umumnya
      // tidak di-track stoknya secara langsung.
      const yieldQty = recipe.yieldQty || 1;
      for (const ing of recipe.ingredients) {
        const deduct = (ing.quantity * totalQty) / yieldQty;
        addDeduction(
          ing.ingredientId,
          ing.ingredientName,
          deduct,
          "RECIPE_DEDUCT",
        );
      }
      continue;
    }

    // Default: decrement self (produk retail biasa).
    addDeduction(item.productId, item.productName, totalQty, "SALE");
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
