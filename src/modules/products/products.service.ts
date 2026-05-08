import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductListResponse,
  ProductResponse,
  UpdateProductDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const PRODUCT_SELECT = {
  id: true,
  code: true,
  name: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  brandId: true,
  brand: { select: { id: true, name: true } },
  supplierId: true,
  supplier: { select: { id: true, name: true } },
  purchasePrice: true,
  sellingPrice: true,
  stock: true,
  minStock: true,
  barcode: true,
  unit: true,
  itemType: true,
  isActive: true,
  description: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  // Counts dipakai UI list utk decide apakah row punya breakdown SKU
  // (multi-unit / multi-variant) sehingga harga/stok master di-hide & user
  // bisa expand row utk lihat detail per SKU.
  _count: {
    select: {
      units: true,
      variants: true,
    },
  },
} satisfies Prisma.ProductSelect;

type RawProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    const {
      search,
      categoryId,
      brandId,
      supplierId,
      itemType,
      excludeIngredient,
      isActive,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;
    const where: Prisma.ProductWhereInput = { companyId, deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (supplierId) where.supplierId = supplierId;
    if (itemType) where.itemType = itemType;
    // POS / cashier flow: exclude bahan baku (INGREDIENT) supaya tidak
    // muncul di list produk yg bisa dijual.
    if (excludeIngredient) {
      where.itemType = { not: "INGREDIENT" };
    }
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.ProductOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "category":
          orderBy = { category: { name: dir } };
          break;
        case "name":
        case "code":
        case "purchasePrice":
        case "sellingPrice":
        case "stock":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.ProductOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products: rows.map(toProductResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException("Product not found");
    return toProductResponse(product);
  }

  // Single-API GET: product + sub-resources untuk product form. Hindari
  // multi-fetch race condition di frontend.
  // `branchId` opsional — kalau di-set, branchSkus & legacy fallback
  // di-filter ke cabang itu saja (sesuai filter sidebar di UI).
  async findDetail(companyId: string, id: string, branchId?: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException("Product not found");
    const [units, branchSkus, tierPrices, variants, modifierGroups, branches] =
      await Promise.all([
        this.prisma.productUnit.findMany({
          where: { productId: id },
          orderBy: [{ sortOrder: "asc" }, { conversionQty: "asc" }],
          select: {
            id: true,
            name: true,
            conversionQty: true,
            sellingPrice: true,
            purchasePrice: true,
            barcode: true,
            isDefault: true,
            sortOrder: true,
          },
        }),
        this.prisma.productBranchSku.findMany({
          where: {
            productId: id,
            ...(branchId ? { branchId } : {}),
          },
          select: {
            id: true,
            branchId: true,
            unitId: true,
            variantId: true,
            sellingPrice: true,
            purchasePrice: true,
            stock: true,
            minStock: true,
            barcode: true,
            isActive: true,
          },
        }),
        this.prisma.productTierPrice.findMany({
          where: { productId: id },
          orderBy: { minQty: "asc" },
          select: { id: true, minQty: true, price: true },
        }),
        this.prisma.productVariant.findMany({
          where: { productId: id },
          include: {
            options: {
              select: {
                optionId: true,
                option: { select: { name: true } },
              },
            },
          },
        }),
        this.prisma.productModifierGroup.findMany({
          where: { productId: id },
          select: { modifierGroupId: true, sortOrder: true },
          orderBy: { sortOrder: "asc" },
        }),
        // Branches dipakai utk enrich branchSkus dgn branchName supaya UI
        // expand row di /products list bisa langsung render tanpa fetch lagi.
        this.prisma.branch.findMany({
          where: { companyId },
          select: { id: true, name: true },
        }),
      ]);

    const branchNameMap = new Map(branches.map((b) => [b.id, b.name]));
    const unitNameMap = new Map(units.map((u) => [u.id, u.name]));
    const variantLabelMap = new Map(
      variants.map((v) => [
        v.id,
        v.options.map((o) => o.option.name).join(" · "),
      ]),
    );

    // Fallback: produk lama yg belum migrasi ke ProductBranchSku — derive
    // synthetic SKU dari BranchProductPrice + BranchStock supaya frontend
    // form bisa nampilkan & di-edit. Save berikutnya akan migrate ke
    // ProductBranchSku via path normal.
    let effectiveBranchSkus: typeof branchSkus = branchSkus;
    if (branchSkus.length === 0) {
      const [legacyPrices, legacyStocks] = await Promise.all([
        this.prisma.branchProductPrice.findMany({
          where: { productId: id, ...(branchId ? { branchId } : {}) },
          select: { branchId: true, sellingPrice: true, purchasePrice: true },
        }),
        this.prisma.branchStock.findMany({
          where: { productId: id, ...(branchId ? { branchId } : {}) },
          select: { branchId: true, quantity: true, minStock: true },
        }),
      ]);
      const stockByBranch = new Map(
        legacyStocks.map((s) => [s.branchId, s]),
      );
      const branchIds = new Set([
        ...legacyPrices.map((p) => p.branchId),
        ...legacyStocks.map((s) => s.branchId),
      ]);
      effectiveBranchSkus = [...branchIds].map((branchId) => {
        const pr = legacyPrices.find((p) => p.branchId === branchId);
        const st = stockByBranch.get(branchId);
        return {
          // Synthetic id (tidak persist di DB) supaya frontend bisa identify;
          // tidak akan dipakai di save flow (matrix kirim payload tanpa id).
          id: `legacy:${branchId}`,
          branchId,
          unitId: null,
          variantId: null,
          sellingPrice: pr?.sellingPrice ?? product.sellingPrice ?? 0,
          purchasePrice:
            pr?.purchasePrice ?? product.purchasePrice ?? 0,
          stock: st?.quantity ?? 0,
          minStock: st?.minStock ?? product.minStock ?? 5,
          barcode: null,
          isActive: true,
        };
      });
    }

    const enrichedBranchSkus = effectiveBranchSkus.map((s) => ({
      ...s,
      branchName: branchNameMap.get(s.branchId) ?? null,
      unitName: s.unitId ? unitNameMap.get(s.unitId) ?? null : null,
      variantLabel: s.variantId ? variantLabelMap.get(s.variantId) ?? null : null,
    }));

    return {
      ...toProductResponse(product),
      units,
      branchSkus: enrichedBranchSkus,
      tierPrices,
      variants: variants.map((v) => ({
        id: v.id,
        isActive: v.isActive,
        optionIds: v.options.map((o) => o.optionId),
        label: v.options.map((o) => o.option.name).join(" · "),
      })),
      modifierGroupIds: modifierGroups.map((mg) => mg.modifierGroupId),
    };
  }

  private async syncProductModifierGroups(
    companyId: string,
    productId: string,
    modifierGroupIds: string[],
  ): Promise<void> {
    if (modifierGroupIds.length > 0) {
      const owned = await this.prisma.modifierGroup.findMany({
        where: { id: { in: modifierGroupIds }, companyId },
        select: { id: true },
      });
      if (owned.length !== modifierGroupIds.length) {
        throw new BadRequestException(
          "One or more modifier groups invalid",
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productModifierGroup.deleteMany({ where: { productId } });
      if (modifierGroupIds.length > 0) {
        await tx.productModifierGroup.createMany({
          data: modifierGroupIds.map((modifierGroupId, idx) => ({
            productId,
            modifierGroupId,
            sortOrder: idx,
          })),
        });
      }
    });
  }

  private async generateProductCode(companyId: string): Promise<string> {
    // Try a few times to avoid collisions (P2002 from unique [companyId, code]).
    for (let i = 0; i < 5; i++) {
      const candidate = `PRD-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(-3)}`;
      const exists = await this.prisma.product.findFirst({
        where: { companyId, code: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `PRD-${Date.now().toString(36).toUpperCase()}`;
  }

  async create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    try {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await this.generateProductCode(companyId);
      const created = await this.prisma.product.create({
        data: {
          code,
          name: dto.name,
          categoryId: dto.categoryId,
          brandId: dto.brandId ?? null,
          supplierId: dto.supplierId ?? null,
          companyId,
          purchasePrice: dto.purchasePrice,
          sellingPrice: dto.sellingPrice,
          stock: dto.stock ?? 0,
          minStock: dto.minStock ?? 5,
          barcode: dto.barcode ?? null,
          unit: dto.unit ?? "pcs",
          itemType: dto.itemType ?? "PRODUCT",
          isActive: dto.isActive ?? true,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
        },
        select: PRODUCT_SELECT,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          created.id,
          dto.modifierGroupIds,
        );
      }
      // Inline-replace sub-resources kalau dikirim (single-API-call mode).
      // Order penting: units dulu (untuk unit IDs), lalu tier prices, lalu
      // branchSkus (yang resolve unitName → unitId fresh).
      if (dto.productUnits !== undefined) {
        await this.replaceProductUnits(created.id, dto.productUnits);
      }
      if (dto.tierPrices !== undefined) {
        await this.replaceTierPrices(created.id, dto.tierPrices);
      }
      if (dto.branchSkus !== undefined) {
        await this.replaceBranchSkusInline(created.id, dto.branchSkus);
      }
      return toProductResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode atau barcode produk sudah digunakan");
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Product not found");

    const data: Prisma.ProductUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.brandId !== undefined) {
      data.brand = dto.brandId
        ? { connect: { id: dto.brandId } }
        : { disconnect: true };
    }
    if (dto.supplierId !== undefined) {
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    }
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.minStock !== undefined) data.minStock = dto.minStock;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.itemType !== undefined) data.itemType = dto.itemType;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data,
        select: PRODUCT_SELECT,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          id,
          dto.modifierGroupIds,
        );
      }
      // Replace productUnits inline kalau dikirim. Pakai dedicated transaction
      // supaya saat ada SKU yg ke-cascade-delete via ProductUnit FK, frontend
      // bisa kirim branchSkus juga di payload yg sama untuk re-create.
      if (dto.productUnits !== undefined) {
        await this.replaceProductUnits(id, dto.productUnits);
      }
      // Replace tier prices inline.
      if (dto.tierPrices !== undefined) {
        await this.replaceTierPrices(id, dto.tierPrices);
      }
      // Replace branchSkus inline. Resolve unitName → unitId di sini setelah
      // productUnits di-replace, supaya ID baru ke-pakai.
      if (dto.branchSkus !== undefined) {
        await this.replaceBranchSkusInline(id, dto.branchSkus);
      }
      return toProductResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode atau barcode produk sudah digunakan");
      }
      throw err;
    }
  }

  // Replace productUnits: delete-all + create-from-payload (urutan diawali
  // sortOrder dari index). FK ke ProductBranchSku CASCADE → SKU yg pakai
  // unit ini juga hilang, jadi caller HARUS kirim branchSkus juga (atau
  // siap state SKU kosong).
  private async replaceProductUnits(
    productId: string,
    units: NonNullable<UpdateProductDto["productUnits"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productUnit.deleteMany({ where: { productId } });
      if (units.length === 0) return;
      await tx.productUnit.createMany({
        data: units.map((u, i) => ({
          productId,
          name: u.name,
          conversionQty: u.conversionQty,
          sellingPrice: u.sellingPrice ?? 0,
          purchasePrice: u.purchasePrice ?? null,
          barcode: u.barcode || null,
          isDefault: u.conversionQty === 1 && i === 0,
          sortOrder: i,
        })),
      });
    });
  }

  private async replaceTierPrices(
    productId: string,
    tiers: NonNullable<UpdateProductDto["tierPrices"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productTierPrice.deleteMany({ where: { productId } });
      if (tiers.length === 0) return;
      await tx.productTierPrice.createMany({
        data: tiers.map((t) => ({
          productId,
          minQty: t.minQty,
          price: t.price,
        })),
      });
    });
  }

  // Replace branchSkus: pakai unitName → unitId resolution (hindari ID stale).
  // Sync ke BranchProductPrice + BranchStock + Product entity (legacy aggregate)
  // dalam transaction yg sama → list & POS lihat data konsisten.
  private async replaceBranchSkusInline(
    productId: string,
    items: NonNullable<UpdateProductDto["branchSkus"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Lookup units fresh DI DALAM transaction (untuk antisipasi unit baru
      // dari replaceProductUnits di transaction sebelumnya).
      const units = await tx.productUnit.findMany({
        where: { productId },
        select: { id: true, name: true, conversionQty: true },
        orderBy: { conversionQty: "asc" },
      });
      const unitIdByName = new Map<string, string>();
      for (const u of units) unitIdByName.set(u.name, u.id);
      const baseUnitId = units[0]?.id ?? null;

      // Resolve variant per item via optionIds find-or-create.
      const resolved: Array<{
        branchId: string;
        unitId: string | null;
        variantId: string | null;
        sellingPrice: number;
        purchasePrice: number;
        stock: number;
        minStock: number;
        barcode: string | null;
        isActive: boolean;
      }> = [];
      for (const item of items) {
        let unitId: string | null = null;
        if (item.unitName) {
          const id = unitIdByName.get(item.unitName);
          if (!id) {
            throw new BadRequestException(
              `Satuan "${item.unitName}" tidak ditemukan untuk produk ini`,
            );
          }
          unitId = id;
        }
        let variantId: string | null = null;
        if (item.optionIds && item.optionIds.length > 0) {
          const sortedIncoming = [...item.optionIds].sort().join("|");
          const candidates = await tx.productVariant.findMany({
            where: { productId },
            include: { options: { select: { optionId: true } } },
          });
          const matched = candidates.find(
            (v) =>
              v.options.map((o) => o.optionId).sort().join("|") ===
              sortedIncoming,
          );
          if (matched) {
            variantId = matched.id;
          } else {
            const created = await tx.productVariant.create({
              data: {
                productId,
                isActive: true,
                options: {
                  create: item.optionIds.map((oid) => ({ optionId: oid })),
                },
              },
            });
            variantId = created.id;
          }
        }
        resolved.push({
          branchId: item.branchId,
          unitId,
          variantId,
          sellingPrice: item.sellingPrice,
          purchasePrice: item.purchasePrice,
          stock: item.stock ?? 0,
          minStock: item.minStock ?? 5,
          barcode: item.barcode || null,
          isActive: item.isActive ?? true,
        });
      }

      // Validate uniqueness (branch, unit, variant) di payload.
      const seen = new Set<string>();
      for (const r of resolved) {
        const key = `${r.branchId}|${r.unitId ?? ""}|${r.variantId ?? ""}`;
        if (seen.has(key)) {
          throw new BadRequestException(
            "Duplikat: kombinasi cabang/satuan/varian tidak boleh sama",
          );
        }
        seen.add(key);
      }

      // Replace SKU: delete all existing for product, then bulk create.
      await tx.productBranchSku.deleteMany({ where: { productId } });
      if (resolved.length > 0) {
        await tx.productBranchSku.createMany({
          data: resolved.map((r) => ({
            productId,
            branchId: r.branchId,
            unitId: r.unitId,
            variantId: r.variantId,
            sellingPrice: r.sellingPrice,
            purchasePrice: r.purchasePrice,
            stock: r.stock,
            minStock: r.minStock,
            barcode: r.barcode,
            isActive: r.isActive,
          })),
        });
      }

      // Sync ke tabel legacy + Product entity dari cell base-unit per branch.
      const perBranch = new Map<
        string,
        { sellingPrice: number; purchasePrice: number; stock: number; minStock: number }
      >();
      for (const r of resolved) {
        const isBase = baseUnitId ? r.unitId === baseUnitId : !r.unitId;
        if (!isBase) continue;
        if (perBranch.has(r.branchId)) continue;
        perBranch.set(r.branchId, {
          sellingPrice: r.sellingPrice,
          purchasePrice: r.purchasePrice,
          stock: r.stock,
          minStock: r.minStock,
        });
      }

      // Hapus legacy untuk branch yang TIDAK ada di payload (kalau matrix
      // user kosongkan suatu branch, harus di-clean di legacy juga).
      const branchIdsInPayload = [...perBranch.keys()];
      await tx.branchProductPrice.deleteMany({
        where: {
          productId,
          branchId: branchIdsInPayload.length
            ? { notIn: branchIdsInPayload }
            : undefined,
        },
      });
      await tx.branchStock.deleteMany({
        where: {
          productId,
          branchId: branchIdsInPayload.length
            ? { notIn: branchIdsInPayload }
            : undefined,
        },
      });

      for (const [branchId, vals] of perBranch.entries()) {
        await tx.branchProductPrice.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
          update: {
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
        });
        await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            quantity: vals.stock,
            minStock: vals.minStock,
          },
          update: {
            quantity: vals.stock,
            minStock: vals.minStock,
          },
        });
      }

      // Sync Product entity (global aggregate untuk list view).
      const totalStock = [...perBranch.values()].reduce(
        (sum, v) => sum + v.stock,
        0,
      );
      const repCell = [...perBranch.values()][0];
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: totalStock,
          ...(repCell
            ? {
                purchasePrice: repCell.purchasePrice,
                sellingPrice: repCell.sellingPrice,
                minStock: repCell.minStock,
              }
            : {}),
        },
      });
    });
  }

  async softDelete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Product not found");

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }

  async stats(
    companyId: string,
    branchId?: string,
  ): Promise<{
    total: number;
    active: number;
    lowStock: number;
    outOfStock: number;
  }> {
    if (branchId) {
      const result = await this.prisma.$queryRaw<
        [{
          total: bigint;
          active: bigint;
          low_stock: bigint;
          out_of_stock: bigint;
        }]
      >`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE p."isActive" = true)::int AS active,
               COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) > 0 AND COALESCE(bs.quantity, 0) <= 10)::int AS low_stock,
               COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) = 0)::int AS out_of_stock
          FROM products p
          LEFT JOIN branch_stocks bs ON bs."productId" = p.id AND bs."branchId" = ${branchId}
          WHERE p."companyId" = ${companyId} AND p."deletedAt" IS NULL
      `;
      const r = result[0];
      return {
        total: Number(r.total),
        active: Number(r.active),
        lowStock: Number(r.low_stock),
        outOfStock: Number(r.out_of_stock),
      };
    }
    const result = await this.prisma.$queryRaw<
      [{
        total: bigint;
        active: bigint;
        low_stock: bigint;
        out_of_stock: bigint;
      }]
    >`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "isActive" = true)::int AS active,
             COUNT(*) FILTER (WHERE stock > 0 AND stock <= 10)::int AS low_stock,
             COUNT(*) FILTER (WHERE stock = 0)::int AS out_of_stock
        FROM products
        WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
    `;
    const r = result[0];
    return {
      total: Number(r.total),
      active: Number(r.active),
      lowStock: Number(r.low_stock),
      outOfStock: Number(r.out_of_stock),
    };
  }

  // Generate kode produk unik mirror dari DB trigger phase3_product_code_trigger.sql.
  // Format: {COMPANY_SLUG_UPPER 6 char}-{4-digit sequence}, contoh: TOKO-0001.
  // Dipakai untuk preview/auto-fill di form sebelum submit (tanpa create row).
  async generateUniqueProductCode(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { slug: true },
    });
    const rawSlug = (company?.slug || "PRD").replace(/[^a-zA-Z0-9]/g, "");
    const slug = (rawSlug || "PRD").toUpperCase().slice(0, 6);
    const prefix = `${slug}-`;

    // Ambil semua kode dengan prefix ini, parse sequence number, cari max + 1.
    const rows = await this.prisma.product.findMany({
      where: { companyId, code: { startsWith: prefix } },
      select: { code: true },
    });
    let maxSeq = 0;
    for (const r of rows) {
      const tail = r.code.slice(prefix.length);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxSeq) maxSeq = n;
      }
    }

    // Loop sampai dapat kode unik (handle race condition).
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${prefix}${String(maxSeq + 1 + attempt).padStart(4, "0")}`;
      const exists = await this.prisma.product.findFirst({
        where: { companyId, code: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      "Gagal generate kode produk unik setelah 100 percobaan",
    );
  }

  // Generate barcode EAN-13 unik untuk company. Format: prefix "20" (in-store
   // / internal use range 200-299), 10 digit acak, 1 digit check digit (mod 10).
   // Cek collision di Product.barcode + ProductUnit.barcode.
   // Retry hingga 10× bila collision (sangat jarang dengan ruang 10^10).
  async generateUniqueBarcode(
    companyId: string,
    prefix?: string,
  ): Promise<string> {
    // Prefix opsional dari user. Sanitasi: hanya digit, max 3 char. Default
    // "20" = internal/private barcode range (EAN-13 manufacturer-defined).
    const cleanPrefix = (prefix ?? "20").replace(/\D/g, "").slice(0, 3) || "20";
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateEan13(cleanPrefix);
      const collision = await this.barcodeExists(companyId, candidate);
      if (!collision) return candidate;
    }
    throw new InternalServerErrorException(
      "Gagal generate barcode unik setelah 10 percobaan",
    );
  }

  private async barcodeExists(
    companyId: string,
    barcode: string,
  ): Promise<boolean> {
    const [product, unit] = await Promise.all([
      this.prisma.product.findFirst({
        where: { companyId, barcode },
        select: { id: true },
      }),
      this.prisma.productUnit.findFirst({
        where: { barcode, product: { companyId } },
        select: { id: true },
      }),
    ]);
    return Boolean(product || unit);
  }

  async findByBarcode(
    companyId: string,
    barcode: string,
    branchId?: string,
  ): Promise<unknown | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        companyId,
        deletedAt: null,
        OR: [
          { code: barcode },
          { units: { some: { barcode } } },
        ],
      },
      include: {
        category: { select: { name: true } },
        units: true,
      },
    });
    if (!product) return null;
    // Identifikasi satuan yang barcode-nya cocok agar frontend bisa langsung
    // tambah ke cart dengan unit + harga yang tepat (tanpa picker satuan).
    // Cocok untuk kasus rokok: 1 produk, banyak satuan (kardus/pack/bungkus/
    // batang) dengan barcode masing-masing.
    const matchedUnit = product.units.find((u) => u.barcode === barcode) ?? null;
    const branchStock = branchId
      ? (
          await this.prisma.branchStock.findFirst({
            where: { productId: product.id, branchId },
            select: { quantity: true },
          })
        )?.quantity ?? 0
      : undefined;
    return {
      ...product,
      ...(branchStock !== undefined ? { branchStock } : {}),
      matchedUnit: matchedUnit
        ? {
            id: matchedUnit.id,
            name: matchedUnit.name,
            conversionQty: matchedUnit.conversionQty,
            sellingPrice: matchedUnit.sellingPrice,
            purchasePrice: matchedUnit.purchasePrice,
            barcode: matchedUnit.barcode,
          }
        : null,
    };
  }

  async topSelling(
    companyId: string,
    limit = 8,
  ): Promise<unknown[]> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const items = await this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: {
          status: "COMPLETED",
          createdAt: { gte: since },
          user: { companyId },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
    if (items.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
    });
    const map = new Map(products.map((p) => [p.id, p]));
    return items
      .map((it) => {
        const p = map.get(it.productId);
        if (!p) return null;
        return {
          ...p,
          totalQty: it._sum.quantity ?? 0,
          totalRevenue: it._sum.subtotal ?? 0,
        };
      })
      .filter(Boolean);
  }

  async byCategory(
    companyId: string,
    categoryId: string,
  ): Promise<unknown[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        categoryId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async branchView(
    companyId: string,
    params: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      isActive?: boolean;
      stockStatus?: string;
      limit?: number;
      offset?: number;
      onlyWithStock?: boolean;
      // POS mode: when branchId is set, only include products that were
      // explicitly assigned to that branch (have BranchStock or BranchPrice).
      // Tanpa flag ini, view CROSS JOIN-nya membuat semua produk company
      // muncul di tiap branch via fallback ke stock global — yang user lihat
      // sebagai "POS menampilkan semua produk".
      restrictToBranchAssigned?: boolean;
      // F&B: exclude bahan baku (itemType=INGREDIENT) supaya tidak muncul
      // di POS / browse product cashier. Bahan baku hanya dipakai sebagai
      // ingredient di Recipe / BOM, bukan dijual langsung.
      excludeIngredient?: boolean;
      itemType?: "PRODUCT" | "SERVICE" | "INGREDIENT";
    },
  ): Promise<{ rows: unknown[]; total: number }> {
    const {
      branchId,
      search,
      categoryId,
      brandId,
      isActive,
      stockStatus,
      limit = 20,
      offset = 0,
      onlyWithStock = false,
      restrictToBranchAssigned = false,
      excludeIngredient = false,
      itemType,
    } = params;
    const conditions: string[] = ["company_id = $1"];
    const values: unknown[] = [companyId];
    let i = 2;
    if (branchId) {
      conditions.push(`branch_id = $${i++}`);
      values.push(branchId);
    }
    if (search) {
      conditions.push(
        `(product_name ILIKE $${i} OR product_code ILIKE $${i} OR barcode ILIKE $${i})`,
      );
      values.push(`%${search}%`);
      i++;
    }
    if (categoryId) {
      conditions.push(`category_id = $${i++}`);
      values.push(categoryId);
    }
    if (brandId) {
      conditions.push(`brand_id = $${i++}`);
      values.push(brandId);
    }
    if (isActive !== undefined) {
      conditions.push(`is_active = $${i++}`);
      values.push(isActive);
    }
    if (stockStatus === "out") conditions.push("stock = 0");
    else if (stockStatus === "low")
      conditions.push("stock > 0 AND stock <= 10");
    else if (stockStatus === "available") conditions.push("stock > 0");
    if (onlyWithStock) conditions.push("has_branch_stock = true");
    if (restrictToBranchAssigned && branchId) {
      conditions.push("(has_branch_stock = true OR has_branch_price = true)");
    }
    if (excludeIngredient) {
      // View belum punya kolom item_type — pakai subquery ke products.
      // Prisma field `itemType` ter-map ke kolom DB `item_type` via
      // @map("item_type"), jadi nama kolom yang benar di raw SQL adalah
      // snake_case (tanpa double-quote camelCase).
      conditions.push(
        `product_id NOT IN (SELECT id FROM products WHERE item_type = 'INGREDIENT')`,
      );
    }
    if (itemType) {
      conditions.push(
        `product_id IN (SELECT id FROM products WHERE item_type = $${i++})`,
      );
      values.push(itemType);
    }

    const whereClause = conditions.join(" AND ");
    const countQuery = `SELECT COUNT(DISTINCT product_id)::int AS total FROM vw_product_branch WHERE ${whereClause}`;
    const dataQuery = branchId
      ? `SELECT * FROM vw_product_branch WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`
      : `SELECT product_id, product_code, product_name, category_id, category_name,
                brand_id, company_id, base_unit, is_active, image_url, barcode, description,
                MIN(branch_id) AS branch_id, '' AS branch_name, '' AS branch_code,
                (SELECT p."sellingPrice" FROM products p WHERE p.id = product_id)::float8 AS selling_price,
                (SELECT p."purchasePrice" FROM products p WHERE p.id = product_id)::float8 AS purchase_price,
                (SELECT p.stock FROM products p WHERE p.id = product_id)::int4 AS stock,
                (SELECT p."minStock" FROM products p WHERE p.id = product_id)::int4 AS min_stock,
                bool_or(has_branch_stock) AS has_branch_stock,
                bool_or(has_branch_price) AS has_branch_price,
                MAX(unit_count)::int4 AS unit_count,
                MAX(variant_count)::int4 AS variant_count,
                MIN(created_at) AS created_at, MAX(updated_at) AS updated_at
           FROM vw_product_branch
           WHERE ${whereClause}
           GROUP BY product_id, product_code, product_name, category_id, category_name,
                    brand_id, company_id, base_unit, is_active, image_url, barcode, description
           ORDER BY MIN(created_at) DESC
           LIMIT $${i} OFFSET $${i + 1}`;
    const [countRes, rows] = await Promise.all([
      this.prisma.$queryRawUnsafe<[{ total: number | bigint }]>(
        countQuery,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        dataQuery,
        ...values,
        limit,
        offset,
      ),
    ]);
    return { rows, total: Number(countRes[0]?.total ?? 0) };
  }

  async importTemplateData(companyId: string): Promise<{
    categories: { id: string; name: string }[];
    brands: { id: string; name: string }[];
    existingCodes: string[];
    branches: { id: string; name: string; code: string | null }[];
    productCount: number;
  }> {
    const [categories, brands, products, branches, productCount] =
      await Promise.all([
        this.prisma.category.findMany({
          where: { companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.brand.findMany({
          where: { companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.product.findMany({
          where: { companyId },
          select: { code: true },
        }),
        this.prisma.branch.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.product.count({ where: { companyId } }),
      ]);
    return {
      categories,
      brands,
      existingCodes: products.map((p) => p.code),
      branches,
      productCount,
    };
  }
}

function toProductResponse(p: RawProduct): ProductResponse {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    brandId: p.brandId,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name } : null,
    supplierId: p.supplierId,
    supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
    purchasePrice: p.purchasePrice,
    sellingPrice: p.sellingPrice,
    stock: p.stock,
    minStock: p.minStock,
    barcode: p.barcode,
    unit: p.unit,
    itemType: (p.itemType as ProductResponse["itemType"]) ?? "PRODUCT",
    isActive: p.isActive,
    description: p.description,
    imageUrl: p.imageUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    unitCount: p._count?.units ?? 0,
    variantCount: p._count?.variants ?? 0,
  };
}

// Generate 13-digit EAN-13 dengan check digit. `prefix` (1-3 digit) dipakai
// untuk in-store identifier (mis. "20" = internal/private barcode range).
// Sisa digit di-fill random; check digit pakai rumus EAN-13 standard.
function generateEan13(prefix = "20"): string {
  const targetLen = 12; // 12 digit + 1 check digit = 13
  let body = prefix.replace(/\D/g, "").slice(0, 3);
  while (body.length < targetLen) {
    body += Math.floor(Math.random() * 10).toString();
  }
  body = body.slice(0, targetLen);
  // EAN-13 check digit: weighted sum (1,3,1,3,…), result mod 10, then 10-result%10.
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check.toString();
}
