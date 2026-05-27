import type { ProductResponse } from "./dto/products.dto";
import type { RawProduct } from "./products.repository";

export function toProductResponse(p: RawProduct): ProductResponse {
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
    defaultRackId: p.defaultRackId ?? null,
    defaultRack: p.defaultRack
      ? {
          id: p.defaultRack.id,
          code: p.defaultRack.code,
          name: p.defaultRack.name,
          branchId: p.defaultRack.branchId,
        }
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    unitCount: p._count?.units ?? 0,
    variantCount: p._count?.variants ?? 0,
  };
}

export function generateEan13(prefix = "20"): string {
  const targetLen = 12;
  let body = prefix.replace(/\D/g, "").slice(0, 3);
  while (body.length < targetLen) {
    body += Math.floor(Math.random() * 10).toString();
  }
  body = body.slice(0, targetLen);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check.toString();
}
