import { Prisma } from "@prisma/client";
import type { ProductResponse } from "@/contracts";

export const PRODUCT_SELECT = {
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
  isActive: true,
  description: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type RawProduct = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SELECT;
}>;

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
    isActive: p.isActive,
    description: p.description,
    imageUrl: p.imageUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
