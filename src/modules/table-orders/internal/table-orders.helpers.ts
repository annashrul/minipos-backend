import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SESSION_SELECT } from "./table-orders.select";

export async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const last = await tx.orderQueue.findFirst({
    where: { branchId, createdAt: { gte: startOfDay } },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });
  return (last?.queueNumber ?? 0) + 1;
}

export async function nextInvoiceNumber(
  prisma: PrismaService,
  branchId: string,
): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const count = await prisma.transaction.count({
    where: { branchId, createdAt: { gte: startOfDay } },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${ymd}-${seq}`;
}

export async function findTableByToken(
  prisma: PrismaService,
  qrToken: string,
) {
  const table = await prisma.restaurantTable.findUnique({
    where: { qrToken },
    select: {
      id: true,
      number: true,
      name: true,
      section: true,
      status: true,
      branchId: true,
      branch: { select: { id: true, name: true, companyId: true } },
    },
  });
  if (!table || !table.branchId) {
    throw new NotFoundException("Token meja tidak valid");
  }
  return table;
}

export async function findOrderForCompany(
  prisma: PrismaService,
  companyId: string,
  orderId: string,
) {
  const order = await prisma.tableOrder.findFirst({
    where: { id: orderId, branch: { companyId } },
    select: {
      id: true,
      sessionId: true,
      tableId: true,
      branchId: true,
      status: true,
      total: true,
      customerNote: true,
      items: { select: { productName: true, qty: true, note: true } },
    },
  });
  if (!order) throw new NotFoundException("Order tidak ditemukan");
  return order;
}

export async function findSessionForCompany(
  prisma: PrismaService,
  companyId: string,
  sessionId: string,
) {
  const session = await prisma.tableSession.findFirst({
    where: { id: sessionId, branch: { companyId } },
    select: SESSION_SELECT,
  });
  if (!session) throw new NotFoundException("Sesi tidak ditemukan");
  return session;
}
