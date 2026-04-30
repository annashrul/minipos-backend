import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import type { CheckoutDto } from "@/contracts";

export type Deduction = {
  productId: string;
  productName: string;
  quantity: number;
};

export function aggregateDeductions(items: CheckoutDto["items"]): Deduction[] {
  const map = new Map<string, { productName: string; quantity: number }>();
  for (const item of items) {
    if (item.productId.startsWith("bundle:") && item.bundleItems) {
      for (const comp of item.bundleItems) {
        const qty = comp.quantity * item.quantity;
        const prev = map.get(comp.productId);
        map.set(comp.productId, {
          productName: prev?.productName ?? comp.productName,
          quantity: (prev?.quantity ?? 0) + qty,
        });
      }
      continue;
    }
    const qty = item.quantity * (item.conversionQty ?? 1);
    const prev = map.get(item.productId);
    map.set(item.productId, {
      productName: prev?.productName ?? item.productName,
      quantity: (prev?.quantity ?? 0) + qty,
    });
  }
  return Array.from(map.entries()).map(([productId, v]) => ({
    productId,
    productName: v.productName,
    quantity: v.quantity,
  }));
}

export function normalizeCodePart(
  value: string | null | undefined,
  fallback: string,
): string {
  const clean = (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return clean || fallback;
}

export function randomInvoicePart(length = 8): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .toUpperCase()
    .slice(0, length);
}

export function isInvoiceConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("invoiceNumber")) return true;
  }
  return false;
}
