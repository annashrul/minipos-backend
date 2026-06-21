import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import type {
  CheckoutDto,
  CheckoutResponse,
} from "./dto/transactions.dto";
import { DebtsService } from "@/modules/debts/debts.service";
import { PointsService } from "@/modules/points/points.service";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RackStockHelperService } from "@/modules/racks/rack-stock-helper.service";
import { ProductBatchHelperService } from "@/modules/product-batches/product-batch-helper.service";
import { WhatsappReceiptService } from "@/modules/whatsapp-receipt/whatsapp-receipt.service";
import { StockAlertService } from "@/modules/whatsapp-receipt/stock-alert.service";
import { TransactionsRepository } from "./transactions.repository";

import { RealtimeService, EVENTS } from "@/modules/realtime/realtime.service";
import { AutoJournalService } from "@/modules/auto-journal/auto-journal.service";

@Injectable()
export class TransactionCheckoutService {
  private readonly logger = new Logger(TransactionCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: TransactionsRepository,
    private readonly debts: DebtsService,
    private readonly points: PointsService,
    private readonly realtime: RealtimeService,
    private readonly autoJournal: AutoJournalService,
    private readonly whatsapp: WhatsappReceiptService,
    private readonly stockAlert: StockAlertService,
    private readonly rackStockHelper: RackStockHelperService,
    private readonly batchHelper: ProductBatchHelperService,
    private readonly assert: AssertService,
  ) {}

  /**
   * Callback injected by TransactionsService so checkout can void the source
   * transaction during edit-mode (replaceTransactionId) without a circular
   * dependency on TransactionVoidRefundService.
   */
  private _voidFn:
    | ((
        companyId: string,
        userId: string,
        id: string,
        reason: string,
      ) => Promise<unknown>)
    | null = null;

  setVoidFn(
    fn: (
      companyId: string,
      userId: string,
      id: string,
      reason: string,
    ) => Promise<unknown>,
  ) {
    this._voidFn = fn;
  }

  /**
   * Tegakkan batas kredit (credit limit) untuk pembayaran TERMIN. Piutang baru
   * tidak boleh membuat total outstanding melebihi `customer.creditLimit`
   * (0 = tanpa batas). Bila melebihi, transaksi ditolak kecuali ada override
   * otorisasi dari supervisor (role MANAGER ke atas) dengan password valid.
   *
   * Dipanggil SEBELUM membuka transaksi DB karena verifikasi password override
   * bersifat CPU-bound (bcrypt) — tidak boleh menahan koneksi transaksi terbuka.
   */
  private async enforceCreditLimit(
    companyId: string,
    dto: CheckoutDto,
  ): Promise<void> {
    if (!dto.customerId) return;

    // Nominal termin pada checkout ini (yang akan menjadi piutang baru).
    const terminFromPayments = (dto.payments ?? [])
      .filter((p) => p.method === "TERMIN")
      .reduce((sum, p) => sum + p.amount, 0);
    let terminAmount = terminFromPayments;
    if (terminAmount <= 0 && dto.paymentMethod === "TERMIN") {
      terminAmount = dto.paymentAmount > 0 ? dto.paymentAmount : dto.grandTotal;
    }
    if (terminAmount <= 0) return; // bukan transaksi termin → tidak perlu cek

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId },
      select: { id: true, creditLimit: true },
    });
    // Customer invalid ditangani validasi lain di alur checkout; cek limit hanya
    // relevan bila limit aktif (> 0).
    if (!customer || customer.creditLimit <= 0) return;

    const agg = await this.prisma.debt.aggregate({
      where: {
        companyId,
        partyType: "CUSTOMER",
        partyId: dto.customerId,
        type: "RECEIVABLE",
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
      },
      _sum: { remainingAmount: true },
    });
    const outstanding = agg._sum.remainingAmount ?? 0;

    // Piutang baru = nominal termin dikurangi DP (DP langsung mengurangi sisa).
    const downPayment = dto.terminConfig?.downPayment ?? 0;
    const newReceivable = Math.max(terminAmount - downPayment, 0);
    const projected = outstanding + newReceivable;

    if (projected <= customer.creditLimit) return;

    const available = Math.max(customer.creditLimit - outstanding, 0);
    if (!dto.creditOverride) {
      throw new BadRequestException(
        `Melebihi limit kredit pelanggan. Limit: ${customer.creditLimit}, ` +
          `piutang berjalan: ${outstanding}, sisa limit: ${available}, ` +
          `tagihan baru: ${newReceivable}. Perlu persetujuan supervisor.`,
      );
    }

    await this.verifyCreditOverride(companyId, dto.creditOverride);
  }

  /**
   * Validasi override limit kredit: supervisor pemberi izin harus aktif, satu
   * company, berperan MANAGER ke atas, dan password-nya cocok. Memakai
   * `authorizationPassword` bila di-set, jika tidak fallback ke password login.
   * Hashing memakai bcrypt (konsisten dengan auth & users module).
   */
  private async verifyCreditOverride(
    companyId: string,
    override: { email: string; password: string },
  ): Promise<void> {
    const approver = await this.prisma.user.findFirst({
      where: { email: override.email, companyId, isActive: true },
      select: {
        role: true,
        password: true,
        authorizationPassword: true,
      },
    });
    if (!approver) {
      throw new ForbiddenException("Pemberi otorisasi tidak valid");
    }

    const allowedRoles = ["MANAGER", "ADMIN", "SUPER_ADMIN", "PLATFORM_OWNER"];
    if (!allowedRoles.includes(approver.role)) {
      throw new ForbiddenException(
        "Override limit kredit memerlukan role Manager ke atas",
      );
    }

    const hash = approver.authorizationPassword ?? approver.password;
    const valid = await bcrypt.compare(override.password, hash);
    if (!valid) {
      throw new ForbiddenException("Password otorisasi salah");
    }
  }

  /** Verifikasi apoteker/penyetuju penjualan obat resep. Mengembalikan userId. */
  private async verifyPrescriptionApprover(
    companyId: string,
    approver: { email: string; password: string },
  ): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { email: approver.email, companyId, isActive: true },
      select: {
        id: true,
        role: true,
        password: true,
        authorizationPassword: true,
      },
    });
    if (!user) {
      throw new ForbiddenException("Apoteker/pemberi otorisasi tidak valid");
    }
    const allowed = [
      "APOTEKER",
      "PHARMACIST",
      "MANAGER",
      "ADMIN",
      "SUPER_ADMIN",
      "PLATFORM_OWNER",
    ];
    if (!allowed.includes(user.role)) {
      throw new ForbiddenException(
        "Validasi resep memerlukan role Apoteker / Manager ke atas",
      );
    }
    const hash = user.authorizationPassword ?? user.password;
    const valid = await bcrypt.compare(approver.password, hash);
    if (!valid) {
      throw new ForbiddenException("Password apoteker salah");
    }
    return user.id;
  }

  async checkout(
    companyId: string,
    userId: string,
    dto: CheckoutDto,
    retryCount = 0,
  ): Promise<CheckoutResponse> {
    // Idempotensi: kalau key ini sudah pernah ter-checkout untuk company yang
    // sama (mis. retry sinkronisasi transaksi offline), kembalikan transaksi
    // yang sudah ada tanpa membuat duplikat. Points di-set 0 karena sudah
    // diberikan saat create pertama; pemanggil (offline sync) tidak memakainya.
    if (dto.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(
        companyId,
        dto.idempotencyKey,
      );
      if (existing) {
        return {
          id: existing.id,
          invoiceNumber: existing.invoiceNumber,
          invoiceDisplayNumber: existing.invoiceDisplayNumber ?? null,
          pointsEarned: 0,
          pointsRedeemed: 0,
        };
      }
    }

    const branchId = dto.branchId ?? null;
    if (branchId) await this.assert.branch(companyId, branchId);
    if (dto.customerId) await this.assert.customer(companyId, dto.customerId);

    const [company, branch] = await Promise.all([
      this.repo.findCompanySlug(companyId),
      branchId
        ? this.repo.findBranchCode(branchId)
        : Promise.resolve(null),
    ]);
    const invoiceNumber = `${normalizeCodePart(
      company?.slug ?? company?.name,
      "COMPANY",
    )}-${normalizeCodePart(branch?.code ?? branch?.name, "MAIN")}-${randomInvoicePart(8)}`;
    const invoiceDisplayNumber = await this.repo.generateDisplayInvoiceNumber(
      companyId,
      new Date(),
    );

    // Tegakkan batas kredit untuk pembayaran TERMIN sebelum membuka transaksi
    // DB (verifikasi password override bersifat CPU-bound).
    await this.enforceCreditLimit(companyId, dto);

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

    // ─── APOTEK: tegakkan validasi resep untuk obat yang requiresPrescription ──
    let prescriptionApprovedById: string | null = null;
    if (candidateProductIds.length) {
      const rxProducts = await this.prisma.product.findMany({
        where: { id: { in: candidateProductIds }, requiresPrescription: true },
        select: { name: true },
      });
      if (rxProducts.length > 0) {
        if (!dto.prescription) {
          throw new ForbiddenException(
            `Penjualan obat resep (${rxProducts
              .map((p) => p.name)
              .join(", ")}) memerlukan data resep & validasi apoteker.`,
          );
        }
        prescriptionApprovedById = await this.verifyPrescriptionApprover(
          companyId,
          dto.prescription.approver,
        );
      }
    }

    const recipes = candidateProductIds.length
      ? await this.repo.findRecipesByProductIds(candidateProductIds)
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
      const variantRows = await this.repo.findVariantsByProductIds(productIdsWithMods);
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
              prescriptionDoctor: dto.prescription?.doctorName ?? null,
              prescriptionNumber: dto.prescription?.prescriptionNumber ?? null,
              prescriptionPatient: dto.prescription?.patientName ?? null,
              prescriptionApprovedById,
              idempotencyKey: dto.idempotencyKey ?? null,
              syncedFromOffline: dto.syncedFromOffline ?? false,
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

            // Traceability: konsumsi batch FEFO bila produk di-track. Mencatat
            // OUT movement per batch → jejak recall (batch terjual di transaksi
            // mana / ke pelanggan siapa). No-op utk produk biasa (helper cek
            // Product.trackBatch). batchHelper subset BranchStock — kalau qty
            // tidak tercover batch (stok lama untracked) tidak error.
            if (await this.batchHelper.isBatchTracked(tx, d.productId)) {
              await this.batchHelper.consumeFefo(tx, {
                companyId,
                productId: d.productId,
                branchId,
                variantId: d.variantId ?? null,
                qty: qtyInt,
                refType: "transaction",
                refId: newTx.id,
                refNumber: displayRef,
                note,
                createdBy: userId,
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

      // Best-effort: WA alert utk produk yang stoknya jatuh < ambang kritis.
      this.stockAlert.notifyCriticalStock(
        companyId,
        dto.branchId,
        dto.items
          .map((it) => it.productId)
          .filter((id) => !id.startsWith("bundle:")),
      );

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
          const src = await this.repo.findForReplace(
            companyId,
            dto.replaceTransactionId,
          );
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
              if (!this._voidFn) {
                throw new Error(
                  "voidFn not set — TransactionsService must call setVoidFn",
                );
              }
              await this._voidFn(
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
      // Race idempotensi: dua sinkronisasi paralel membawa key sama → salah
      // satu kena unique violation. Ambil & kembalikan transaksi yang sudah
      // dibuat oleh request pemenang, bukan melempar error duplikat.
      if (dto.idempotencyKey && isIdempotencyConflict(err)) {
        const existing = await this.repo.findByIdempotencyKey(
          companyId,
          dto.idempotencyKey,
        );
        if (existing) {
          return {
            id: existing.id,
            invoiceNumber: existing.invoiceNumber,
            invoiceDisplayNumber: existing.invoiceDisplayNumber ?? null,
            pointsEarned: 0,
            pointsRedeemed: 0,
          };
        }
      }
      throw err;
    }
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
    if (branchId) await this.assert.branch(companyId, branchId);
    if (dto.customerId) await this.assert.customer(companyId, dto.customerId);
    const [company, branch] = await Promise.all([
      this.repo.findCompanySlug(companyId),
      branchId
        ? this.repo.findBranchCode(branchId)
        : Promise.resolve(null),
    ]);
    const invoiceNumber = `${normalizeCodePart(
      company?.slug ?? company?.name,
      "COMPANY",
    )}-${normalizeCodePart(branch?.code ?? branch?.name, "MAIN")}-${randomInvoicePart(8)}`;
    const invoiceDisplayNumber = await this.repo.generateDisplayInvoiceNumber(
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
    const source = await this.repo.findForDuplicate(companyId, sourceId);
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
      const customer = await this.repo.findCustomerPhone(companyId, customerId);
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

  private async shouldValidateStock(branchId: string | null): Promise<boolean> {
    const setting = branchId
      ? await this.repo.findSetting("pos.validateStock", branchId)
      : null;
    const fallback = setting
      ? null
      : await this.repo.findSettingFallback("pos.validateStock");
    const value = (setting ?? fallback)?.value;
    return value !== "false";
  }

  private async shouldAutoSendWhatsapp(
    branchId: string | null,
  ): Promise<boolean> {
    const setting = branchId
      ? await this.repo.findSetting("pos.autoSendWhatsappReceipt", branchId)
      : null;
    const fallback = setting
      ? null
      : await this.repo.findSettingFallback("pos.autoSendWhatsappReceipt");
    const value = (setting ?? fallback)?.value;
    // Default true (preserve existing behavior). Hanya off kalau eksplisit "false".
    return value !== "false";
  }
}

// ─── Pure helper functions ──────────────────────────────────────────

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

function isIdempotencyConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target)) return target.includes("idempotencyKey");
    if (typeof target === "string") return target.includes("idempotencyKey");
  }
  return false;
}
