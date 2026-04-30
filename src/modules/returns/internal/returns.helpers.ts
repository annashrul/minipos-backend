import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function generateReturnNumber(): string {
  const now = new Date();
  const datePart = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(
    now.getDate(),
  )}`;
  const hex = randomBytes(3).toString("hex").toUpperCase();
  return `RET-${datePart}-${hex}`;
}

export function generateStoreCreditCode(returnNumber: string): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SC-${returnNumber.replace(/^RET-/, "")}-${suffix}`;
}

export function isReturnNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("returnNumber")) return true;
    if (typeof target === "string" && target.includes("returnNumber")) {
      return true;
    }
  }
  return false;
}
