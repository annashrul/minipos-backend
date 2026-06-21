import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateProductDto,
  ProductResponse,
  UpdateProductDto,
} from "./dto/products.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ProductsRepository } from "./products.repository";
import { toProductResponse } from "./products.helpers";

const INT32_MAX = 2_147_483_647;

@Injectable()
export class ProductCreateUpdateService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Auto-generate kode saat simpan TANPA kode. Skema HARUS sama dengan
  // ProductsService.generateUniqueProductCode (tombol "Generate" di form):
  // `SLUG-0001` sekuensial — supaya urutan maju & tidak duplikat. Sebelumnya
  // memakai skema acak `PRD-xxxx` yang berbeda, sehingga tombol Generate
  // selalu mengembalikan SLUG-0001 (seolah kode yang sama) karena tak ada
  // produk berkode SLUG-.
  private async generateProductCode(companyId: string): Promise<string> {
    const company = await this.repo.findCompanySlug(companyId);
    const rawSlug = (company?.slug || "PRD").replace(/[^a-zA-Z0-9]/g, "");
    const slug = (rawSlug || "PRD").toUpperCase().slice(0, 6);
    const prefix = `${slug}-`;

    // Sertakan produk soft-deleted (kode-nya masih dipakai unique constraint).
    const rows = await this.repo.findProductCodesIncludingDeleted(
      companyId,
      prefix,
    );
    let maxSeq = 0;
    for (const r of rows) {
      const tail = r.code.slice(prefix.length);
      if (/^\d+$/.test(tail)) {
        const n = parseInt(tail, 10);
        if (n > maxSeq) maxSeq = n;
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${prefix}${String(maxSeq + 1 + attempt).padStart(4, "0")}`;
      const exists = await this.repo.codeExistsIncludingDeleted(
        companyId,
        candidate,
      );
      if (!exists) return candidate;
    }
    return `${prefix}${Date.now().toString(36).toUpperCase()}`;
  }

  async create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    try {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await this.generateProductCode(companyId);
      const created = await this.repo.create({
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
        trackBatch: dto.trackBatch ?? false,
        drugClassification: dto.drugClassification ?? null,
        bpomNumber: dto.bpomNumber ?? null,
        requiresPrescription: dto.requiresPrescription ?? false,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        defaultRackId: dto.defaultRackId ?? null,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          created.id,
          dto.modifierGroupIds,
        );
      }
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
      throwIfUniqueConstraint(err, "Kode atau barcode produk sudah digunakan");
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const existing = await this.repo.findExists({ id, companyId });
    if (!existing) throw new NotFoundException("Produk tidak ditemukan");

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
    if (dto.trackBatch !== undefined) data.trackBatch = dto.trackBatch;
    if (dto.drugClassification !== undefined)
      data.drugClassification = dto.drugClassification;
    if (dto.bpomNumber !== undefined) data.bpomNumber = dto.bpomNumber;
    if (dto.requiresPrescription !== undefined)
      data.requiresPrescription = dto.requiresPrescription;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.defaultRackId !== undefined) {
      data.defaultRack = dto.defaultRackId
        ? { connect: { id: dto.defaultRackId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.repo.update(id, data);
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          id,
          dto.modifierGroupIds,
        );
      }
      if (dto.productUnits !== undefined) {
        await this.replaceProductUnits(id, dto.productUnits);
      }
      if (dto.tierPrices !== undefined) {
        await this.replaceTierPrices(id, dto.tierPrices);
      }
      if (dto.branchSkus !== undefined) {
        await this.replaceBranchSkusInline(id, dto.branchSkus);
      }
      return toProductResponse(updated);
    } catch (err) {
      throwIfUniqueConstraint(err, "Kode atau barcode produk sudah digunakan");
    }
  }

  private async syncProductModifierGroups(
    companyId: string,
    productId: string,
    modifierGroupIds: string[],
  ): Promise<void> {
    if (modifierGroupIds.length > 0) {
      const owned = await this.repo.findOwnedModifierGroups(companyId, modifierGroupIds);
      if (owned.length !== modifierGroupIds.length) {
        throw new BadRequestException(
          "Satu atau lebih grup modifier tidak valid",
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

  private async replaceBranchSkusInline(
    productId: string,
    items: NonNullable<UpdateProductDto["branchSkus"]>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const units = await tx.productUnit.findMany({
        where: { productId },
        select: { id: true, name: true, conversionQty: true },
        orderBy: { conversionQty: "asc" },
      });
      const unitIdByName = new Map<string, string>();
      for (const u of units) {
        unitIdByName.set(u.name, u.id);
      }

      const variantCandidates = await tx.productVariant.findMany({
        where: { productId },
        include: { options: { select: { optionId: true } } },
      });
      const variantIdBySignature = new Map<string, string>(
        variantCandidates.map((v) => [
          v.options.map((o) => o.optionId).sort().join("|"),
          v.id,
        ]),
      );

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
          const cachedId = variantIdBySignature.get(sortedIncoming);
          if (cachedId) {
            variantId = cachedId;
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
            variantIdBySignature.set(sortedIncoming, created.id);
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

      const perBranch = new Map<
        string,
        { sellingPrice: number; purchasePrice: number; stock: number; minStock: number }
      >();
      for (const r of resolved) {
        if (!r.isActive) continue;
        const current = perBranch.get(r.branchId);
        const isBaseCell = !r.unitId;
        if (!current) {
          perBranch.set(r.branchId, {
            sellingPrice: r.sellingPrice,
            purchasePrice: r.purchasePrice,
            stock: isBaseCell ? r.stock : 0,
            minStock: r.minStock,
          });
          continue;
        }
        if (isBaseCell) {
          current.sellingPrice = r.sellingPrice;
          current.purchasePrice = r.purchasePrice;
          current.stock = r.stock;
          current.minStock = r.minStock;
        }
      }

      const branchIdsInPayload = [...perBranch.keys()];
      if (branchIdsInPayload.length > 0) {
        await tx.branchProductPrice.deleteMany({
          where: {
            productId,
            branchId: { notIn: branchIdsInPayload },
          },
        });
        await tx.branchStock.deleteMany({
          where: {
            productId,
            branchId: { notIn: branchIdsInPayload },
          },
        });
      }

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
        const aggregateStock = Math.min(vals.stock, INT32_MAX);
        await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            quantity: aggregateStock,
            minStock: vals.minStock,
          },
          update: {
            quantity: aggregateStock,
            minStock: vals.minStock,
          },
        });
      }

      const totalStock = Math.min([...perBranch.values()].reduce(
        (sum, v) => sum + v.stock,
        0,
      ), INT32_MAX);
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
}
