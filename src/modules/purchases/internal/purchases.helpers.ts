import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayCompact(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomHex(length: number): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateOrderNumber(): string {
  return `PO-${todayCompact()}-${randomHex(6)}`;
}

export function generateReceiptNumber(): string {
  return `GR-${todayCompact()}-${randomHex(6)}`;
}

export function isOrderNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("orderNumber")) return true;
  }
  return false;
}

export function isReceiptNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("receiptNumber")) return true;
  }
  return false;
}

export async function assertSupplier(
  prisma: PrismaService,
  companyId: string,
  supplierId: string,
): Promise<void> {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId },
    select: { id: true },
  });
  if (!supplier) throw new NotFoundException("Supplier tidak ditemukan");
}

export async function assertBranch(
  prisma: PrismaService,
  companyId: string,
  branchId: string,
): Promise<void> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, companyId },
    select: { id: true },
  });
  if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
}
