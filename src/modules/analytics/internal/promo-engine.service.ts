import { Injectable } from "@nestjs/common";
import type {
  ActivePromotionResponse,
  AppliedPromoResponse,
  CalculateAutoPromoDto,
  CalculateAutoPromoResponse,
  FindCustomerByPhoneResponse,
  TebusMurahOptionResponse,
  TebusMurahOptionsDto,
  ValidateVoucherDto,
  ValidateVoucherResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class PromoEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivePromotions(
    companyId: string,
  ): Promise<ActivePromotionResponse[]> {
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    return promos.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      value: p.value,
      minPurchase: p.minPurchase,
      maxDiscount: p.maxDiscount,
      scope: p.scope,
      categoryId: p.categoryId,
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      productId: p.productId,
      product: p.product ? { id: p.product.id, name: p.product.name } : null,
      buyQty: p.buyQty,
      getQty: p.getQty,
      getProductId: p.getProductId,
      voucherCode: p.voucherCode,
      description: p.description,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
    }));
  }

  async calculateAutoPromo(
    companyId: string,
    body: CalculateAutoPromoDto,
  ): Promise<CalculateAutoPromoResponse> {
    const { items, subtotal } = body;
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: { notIn: ["VOUCHER", "BUNDLE"] },
      },
      include: {
        category: { select: { id: true } },
        product: { select: { id: true } },
      },
    });

    const appliedPromos: AppliedPromoResponse[] = [];
    let totalDiscount = 0;

    const productIdsForPrice = promotions
      .map((promo) => promo.getProductId)
      .filter((id): id is string => Boolean(id));
    const productPriceMap =
      productIdsForPrice.length > 0
        ? new Map(
            (
              await this.prisma.product.findMany({
                where: { id: { in: Array.from(new Set(productIdsForPrice)) } },
                select: { id: true, sellingPrice: true },
              })
            ).map((p) => [p.id, p.sellingPrice]),
          )
        : new Map<string, number>();

    const findQualifiedItems = (promo: {
      productId: string | null;
      categoryId: string | null;
    }) => {
      if (promo.productId)
        return items.filter((i) => i.productId === promo.productId);
      if (promo.categoryId)
        return items.filter((i) => i.categoryId === promo.categoryId);
      return items;
    };

    const capDiscount = (value: number, maxDiscount: number | null) => {
      if (!maxDiscount) return value;
      return value > maxDiscount ? maxDiscount : value;
    };

    for (const promo of promotions) {
      if (promo.minPurchase && subtotal < promo.minPurchase) continue;
      const qualifiedItems = findQualifiedItems(promo);
      if (qualifiedItems.length === 0) continue;

      if (promo.type === "DISCOUNT_PERCENT") {
        const baseAmount =
          promo.productId || promo.categoryId
            ? qualifiedItems.reduce((sum, item) => sum + item.subtotal, 0)
            : subtotal;
        const disc = capDiscount(
          Math.round(baseAmount * (promo.value / 100)),
          promo.maxDiscount,
        );
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "DISCOUNT_AMOUNT") {
        const disc = capDiscount(promo.value, promo.maxDiscount);
        if (disc <= 0) continue;
        appliedPromos.push({
          promoId: promo.id,
          promoName: promo.name,
          type: promo.type,
          discountAmount: disc,
          appliedTo: promo.productId || promo.categoryId || "cart",
        });
        totalDiscount += disc;
      } else if (promo.type === "BUY_X_GET_Y") {
        const buyQty = promo.buyQty || 1;
        const getQty = promo.getQty || 1;
        const buyItem = promo.productId
          ? items.find((i) => i.productId === promo.productId)
          : qualifiedItems[0];
        if (buyItem && buyItem.quantity >= buyQty) {
          const multiplier = Math.floor(buyItem.quantity / buyQty);
          const freeItems = multiplier * getQty;
          const targetProductId = promo.getProductId || buyItem.productId;
          const targetItem = items.find(
            (i) => i.productId === targetProductId,
          );
          const freeUnitPrice =
            targetItem?.unitPrice ||
            productPriceMap.get(targetProductId) ||
            buyItem.unitPrice;
          const disc = capDiscount(
            freeItems * freeUnitPrice,
            promo.maxDiscount,
          );
          if (disc <= 0) continue;
          // Map promo ke BUY product (yang ADA di cart), bukan GET product —
          // frontend butuh cart-line ID untuk render badge promo per-line.
          appliedPromos.push({
            promoId: promo.id,
            promoName: promo.name,
            type: promo.type,
            discountAmount: disc,
            appliedTo: buyItem.productId,
          });
          totalDiscount += disc;
        }
      }
    }

    return { promos: appliedPromos, totalDiscount };
  }

  async validateVoucher(
    companyId: string,
    body: ValidateVoucherDto,
  ): Promise<ValidateVoucherResponse> {
    const { code, subtotal } = body;
    const now = new Date();
    const promo = await this.prisma.promotion.findFirst({
      where: {
        voucherCode: code.toUpperCase(),
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "VOUCHER",
      },
    });

    if (!promo) return { error: "Voucher tidak valid atau sudah expired" };
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
      return { error: "Voucher sudah habis digunakan" };
    }
    if (promo.minPurchase && subtotal < promo.minPurchase) {
      return {
        error: `Minimum pembelian ${promo.minPurchase} untuk voucher ini`,
      };
    }

    let discount = promo.value;
    if (promo.maxDiscount && discount > promo.maxDiscount)
      discount = promo.maxDiscount;

    return {
      success: true,
      promoId: promo.id,
      promoName: promo.name,
      discount,
    };
  }

  async findCustomerByPhone(
    companyId: string,
    phone: string,
  ): Promise<FindCustomerByPhoneResponse> {
    if (!phone || phone.length < 4) return null;

    return this.prisma.customer.findFirst({
      where: {
        companyId,
        OR: [{ phone: { contains: phone } }, { memberCardCode: phone }],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        memberLevel: true,
        points: true,
        totalSpending: true,
        memberCardCode: true,
      },
    });
  }

  async getTebusMurahOptions(
    companyId: string,
    body: TebusMurahOptionsDto,
  ): Promise<TebusMurahOptionResponse[]> {
    const { items, subtotal, selections } = body;
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: {
        isActive: true,
        companyId,
        startDate: { lte: now },
        endDate: { gte: now },
        type: "BUNDLE",
        getProductId: { not: null },
      },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const productIds = promos
      .map((promo) => promo.getProductId)
      .filter((id): id is string => Boolean(id));
    const products = await this.prisma.product.findMany({
      where: { id: { in: Array.from(new Set(productIds)) } },
      select: {
        id: true,
        name: true,
        code: true,
        sellingPrice: true,
        stock: true,
        imageUrl: true,
        minStock: true,
      },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const selectedQtyMap = new Map(
      (selections ?? []).map((item) => [item.promoId, item.quantity]),
    );

    return promos
      .map((promo) => {
        const triggerQty = promo.productId
          ? items
              .filter((item) => item.productId === promo.productId)
              .reduce((sum, item) => sum + item.quantity, 0)
          : promo.categoryId
            ? items
                .filter((item) => item.categoryId === promo.categoryId)
                .reduce((sum, item) => sum + item.quantity, 0)
            : items.reduce((sum, item) => sum + item.quantity, 0);
        const buyQty = promo.buyQty || 1;
        const triggerMultiplier =
          promo.productId || promo.categoryId
            ? Math.floor(triggerQty / buyQty)
            : 1;
        const minPurchaseMultiplier = promo.minPurchase
          ? Math.floor(subtotal / promo.minPurchase)
          : Number.POSITIVE_INFINITY;
        const eligibleMultiplier = Math.min(
          triggerMultiplier || 0,
          minPurchaseMultiplier,
        );
        const tebusPerMultiplier = promo.getQty || 1;
        const rawMaxQty =
          eligibleMultiplier > 0 ? tebusPerMultiplier * eligibleMultiplier : 0;
        const maxQty = promo.maxDiscount
          ? Math.min(rawMaxQty, Math.floor(promo.maxDiscount))
          : rawMaxQty;
        const usedQty = selectedQtyMap.get(promo.id) || 0;
        const remainingQty = Math.max(0, maxQty - usedQty);
        const product = promo.getProductId
          ? productMap.get(promo.getProductId)
          : null;
        if (!product || remainingQty <= 0) return null;
        return {
          promoId: promo.id,
          promoName: promo.name,
          tebusPrice: promo.value,
          buyQty,
          tebusQty: tebusPerMultiplier,
          maxQty,
          usedQty,
          remainingQty,
          triggerLabel: promo.product
            ? `Beli ${buyQty} ${promo.product.name}`
            : promo.category
              ? `Beli ${buyQty} produk kategori ${promo.category.name}`
              : promo.minPurchase
                ? `Belanja minimal ${promo.minPurchase}`
                : "Belanja produk promo",
          product: {
            id: product.id,
            name: product.name,
            code: product.code,
            sellingPrice: product.sellingPrice,
            stock: product.stock,
            minStock: product.minStock,
            imageUrl: product.imageUrl,
          },
        } satisfies TebusMurahOptionResponse;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
}
