import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// SELECT constants & Raw types
// ─────────────────────────────────────────────────────────────────────────────

export const RACK_SELECT = {
  id: true,
  code: true,
  name: true,
  location: true,
  notes: true,
  isActive: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RackSelect;

export type RawRack = Prisma.RackGetPayload<{ select: typeof RACK_SELECT }>;

@Injectable()
export class RacksRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Core CRUD ────────────────────────────────────────────────────────────

  async findMany(
    where: Prisma.RackWhereInput,
    skip: number,
    take: number,
  ): Promise<RawRack[]> {
    return this.prisma.rack.findMany({
      where,
      select: RACK_SELECT,
      orderBy: [{ branchId: "asc" }, { code: "asc" }],
      skip,
      take,
    });
  }

  async count(where: Prisma.RackWhereInput): Promise<number> {
    return this.prisma.rack.count({ where });
  }

  async findOne(where: Prisma.RackWhereInput): Promise<RawRack | null> {
    return this.prisma.rack.findFirst({
      where,
      select: RACK_SELECT,
    });
  }

  async findExistence(
    where: Prisma.RackWhereInput,
  ): Promise<{ id: true } | null> {
    return this.prisma.rack.findFirst({
      where,
      select: { id: true },
    }) as Promise<{ id: true } | null>;
  }

  async findWithStockCount(
    companyId: string,
    id: string,
  ): Promise<{ id: string; _count: { rackStocks: number } } | null> {
    return this.prisma.rack.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { rackStocks: true } } },
    });
  }

  async findWithBranch(
    companyId: string,
    id: string,
  ): Promise<{ id: string; branchId: string; code: string } | null> {
    return this.prisma.rack.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true, code: true },
    });
  }

  async findWithBranchId(
    companyId: string,
    id: string,
  ): Promise<{ id: string; branchId: string } | null> {
    return this.prisma.rack.findFirst({
      where: { id, companyId },
      select: { id: true, branchId: true },
    });
  }

  async create(data: Prisma.RackUncheckedCreateInput): Promise<RawRack> {
    return this.prisma.rack.create({
      data,
      select: RACK_SELECT,
    });
  }

  async update(id: string, data: Prisma.RackUpdateInput): Promise<RawRack> {
    return this.prisma.rack.update({
      where: { id },
      data,
      select: RACK_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.rack.delete({ where: { id } });
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  async countSummary(
    where: Prisma.RackWhereInput,
  ): Promise<{ total: number; active: number; inactive: number }> {
    const [total, active, inactive] = await Promise.all([
      this.prisma.rack.count({ where }),
      this.prisma.rack.count({ where: { ...where, isActive: true } }),
      this.prisma.rack.count({ where: { ...where, isActive: false } }),
    ]);
    return { total, active, inactive };
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────

  async findSkippedRacks(
    companyId: string,
    ids: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.rack.findMany({
      where: { id: { in: ids }, companyId, rackStocks: { some: {} } },
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }

  async findDeletableRackIds(
    companyId: string,
    ids: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.rack.findMany({
      where: { id: { in: ids }, companyId, rackStocks: { none: {} } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async clearDefaultRackIds(
    companyId: string,
    rackIds: string[],
  ): Promise<void> {
    await this.prisma.product.updateMany({
      where: { defaultRackId: { in: rackIds }, companyId },
      data: { defaultRackId: null },
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    const result = await this.prisma.rack.deleteMany({
      where: { id: { in: ids } },
    });
    return result.count;
  }

  // ── Stock aggregation for list ───────────────────────────────────────────

  async groupRackStocks(rackIds: string[]) {
    if (rackIds.length === 0) return [];
    return this.prisma.rackStock.groupBy({
      by: ["rackId"],
      where: { rackId: { in: rackIds }, qty: { gt: 0 } },
      _count: { productId: true },
      _sum: { qty: true },
    });
  }

  async groupDefaultRackProducts(rackIds: string[], companyId: string) {
    if (rackIds.length === 0) return [];
    return this.prisma.product.groupBy({
      by: ["defaultRackId"],
      where: { defaultRackId: { in: rackIds }, companyId },
      _count: { id: true },
    });
  }

  // ── Detail: rack stocks + default products ───────────────────────────────

  async findRackStocks(rackId: string) {
    return this.prisma.rackStock.findMany({
      where: { rackId },
      select: {
        qty: true,
        product: {
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            imageUrl: true,
            defaultRackId: true,
          },
        },
      },
      orderBy: { qty: "desc" },
    });
  }

  async findDefaultProducts(rackId: string, companyId: string) {
    return this.prisma.product.findMany({
      where: { defaultRackId: rackId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        imageUrl: true,
      },
    });
  }

  // ── Product lookup ───────────────────────────────────────────────────────

  async findProduct(companyId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        defaultRackId: true,
      },
    });
  }

  async findProductRackStocks(
    productId: string,
    companyId: string,
    branchId?: string,
  ) {
    const where: Prisma.RackStockWhereInput = {
      productId,
      rack: { companyId },
    };
    if (branchId) where.branchId = branchId;

    return this.prisma.rackStock.findMany({
      where,
      select: {
        qty: true,
        rack: {
          select: {
            id: true,
            code: true,
            name: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { qty: "desc" },
    });
  }

  // ── Branch validation ────────────────────────────────────────────────────

  async findBranchInCompany(
    branchId: string,
    companyId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
  }

  // ── Product validation ───────────────────────────────────────────────────

  async findProductsInCompany(
    productIds: string[],
    companyId: string,
  ): Promise<{ id: string }[]> {
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });
  }

  // ── Transfer validation ──────────────────────────────────────────────────

  async findRackForTransfer(
    companyId: string,
    rackId: string,
  ): Promise<{ id: string; branchId: string; code: string } | null> {
    return this.prisma.rack.findFirst({
      where: { id: rackId, companyId },
      select: { id: true, branchId: true, code: true },
    });
  }

  // ── Movements ────────────────────────────────────────────────────────────

  async findManyMovements(
    where: Prisma.RackStockMovementWhereInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.rackStockMovement.findMany({
      where,
      select: {
        id: true,
        qty: true,
        type: true,
        refType: true,
        refId: true,
        notes: true,
        createdAt: true,
        byUserId: true,
        byUser: { select: { id: true, name: true } },
        branchId: true,
        branch: { select: { id: true, name: true } },
        productId: true,
        product: {
          select: { id: true, code: true, name: true, unit: true },
        },
        fromRackId: true,
        fromRack: { select: { id: true, code: true } },
        toRackId: true,
        toRack: { select: { id: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countMovements(
    where: Prisma.RackStockMovementWhereInput,
  ): Promise<number> {
    return this.prisma.rackStockMovement.count({ where });
  }

  // ── Discrepancies ────────────────────────────────────────────────────────

  async findDiscrepancy(
    companyId: string,
    id: string,
  ) {
    return this.prisma.rackDiscrepancy.findFirst({
      where: { id, companyId, status: "OPEN" },
      select: {
        id: true,
        rackId: true,
        productId: true,
        branchId: true,
        actualQty: true,
        expectedQty: true,
        difference: true,
      },
    });
  }

  async findManyDiscrepancies(
    companyId: string,
    status?: "OPEN" | "RESOLVED",
  ) {
    const where: Prisma.RackDiscrepancyWhereInput = { companyId };
    if (status) where.status = status;

    return this.prisma.rackDiscrepancy.findMany({
      where,
      select: {
        id: true,
        rackId: true,
        rack: { select: { code: true } },
        productId: true,
        product: { select: { code: true, name: true } },
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedBy: { select: { name: true } },
        reportedAt: true,
        resolvedAt: true,
      },
      orderBy: { reportedAt: "desc" },
    });
  }

  async createDiscrepancy(
    data: Prisma.RackDiscrepancyUncheckedCreateInput,
  ) {
    return this.prisma.rackDiscrepancy.create({
      data,
      select: {
        id: true,
        rackId: true,
        productId: true,
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedAt: true,
        resolvedAt: true,
        reportedBy: { select: { name: true } },
      },
    });
  }

  async findDiscrepancyById(id: string) {
    return this.prisma.rackDiscrepancy.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        rackId: true,
        rack: { select: { code: true } },
        productId: true,
        product: { select: { code: true, name: true } },
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedBy: { select: { name: true } },
        reportedAt: true,
        resolvedAt: true,
      },
    });
  }
}
