import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export function throwIfUniqueConstraint(err: unknown, message: string): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(message);
  }
  throw err;
}
