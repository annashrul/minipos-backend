import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateRackDto,
  ListRacksQueryDto,
  ProductRackLookupResponse,
  RackDetailResponse,
  RackListResponse,
  RackResponse,
  UpdateRackDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const RACK_SELECT = {
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

type RawRack = Prisma.RackGetPayload<{ select: typeof RACK_SELECT }>;

@Injectable()
export class RacksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListRacksQueryDto,
  ): Promise<RackListResponse> {
    const { search, branchId, isActive, page, perPage } = query;
    const where: Prisma.RackWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const [rows, total] = await Promise.all([
      this.prisma.rack.findMany({
        where,
        select: RACK_SELECT,
        orderBy: [{ branchId: "asc" }, { code: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.rack.count({ where }),
    ]);

    const rackIds = rows.map((r) => r.id);
    const stocks =
      rackIds.length > 0
        ? await this.prisma.rackStock.groupBy({
            by: ["rackId"],
            where: { rackId: { in: rackIds } },
            _count: { productId: true },
            _sum: { qty: true },
          })
        : [];

    const stockMap = new Map(
      stocks.map((s) => [
        s.rackId,
        {
          productCount: s._count.productId,
          totalQty: s._sum.qty ?? 0,
        },
      ]),
    );

    return {
      racks: rows.map((r) => toRackResponse(r, stockMap.get(r.id))),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<RackDetailResponse> {
    const rack = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: RACK_SELECT,
    });
    if (!rack) throw new NotFoundException("Rack not found");

    const items = await this.prisma.rackStock.findMany({
      where: { rackId: id },
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

    const stockSummary = {
      productCount: items.length,
      totalQty: items.reduce((sum, i) => sum + i.qty, 0),
    };

    return {
      ...toRackResponse(rack, stockSummary),
      items: items.map((s) => ({
        productId: s.product.id,
        productCode: s.product.code,
        productName: s.product.name,
        unit: s.product.unit,
        qty: s.qty,
        imageUrl: s.product.imageUrl,
        isDefaultRack: s.product.defaultRackId === id,
      })),
    };
  }

  async create(
    companyId: string,
    dto: CreateRackDto,
  ): Promise<RackResponse> {
    // Verify branch belongs to company
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException("Branch tidak ditemukan");
    }
    try {
      const created = await this.prisma.rack.create({
        data: {
          branchId: dto.branchId,
          companyId,
          code: dto.code,
          name: dto.name,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
          isActive: dto.isActive ?? true,
        },
        select: RACK_SELECT,
      });
      return toRackResponse(created);
    } catch (err) {
      throwOnDupRack(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateRackDto,
  ): Promise<RackResponse> {
    const existing = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Rack not found");

    const data: Prisma.RackUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const updated = await this.prisma.rack.update({
        where: { id },
        data,
        select: RACK_SELECT,
      });
      return toRackResponse(updated);
    } catch (err) {
      throwOnDupRack(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        _count: { select: { rackStocks: true } },
      },
    });
    if (!existing) throw new NotFoundException("Rack not found");
    if (existing._count.rackStocks > 0) {
      throw new BadRequestException(
        `Rak masih punya ${existing._count.rackStocks} produk dengan stok. Pindahkan stok dulu sebelum hapus.`,
      );
    }
    // Clear defaultRackId on any product still pointing here
    await this.prisma.product.updateMany({
      where: { defaultRackId: id, companyId },
      data: { defaultRackId: null },
    });
    await this.prisma.rack.delete({ where: { id } });
    return { success: true };
  }

  async productLookup(
    companyId: string,
    productId: string,
    branchId?: string,
  ): Promise<ProductRackLookupResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        defaultRackId: true,
      },
    });
    if (!product) throw new NotFoundException("Product not found");

    const where: Prisma.RackStockWhereInput = {
      productId,
      rack: { companyId },
    };
    if (branchId) where.branchId = branchId;

    const stocks = await this.prisma.rackStock.findMany({
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

    const totalQty = stocks.reduce((sum, s) => sum + s.qty, 0);
    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      unit: product.unit,
      totalQty,
      locations: stocks.map((s) => ({
        rackId: s.rack.id,
        rackCode: s.rack.code,
        rackName: s.rack.name,
        branchId: s.rack.branch.id,
        branchName: s.rack.branch.name,
        qty: s.qty,
        isDefault: product.defaultRackId === s.rack.id,
      })),
    };
  }
}

function toRackResponse(
  r: RawRack,
  summary?: { productCount: number; totalQty: number },
): RackResponse {
  return {
    id: r.id,
    branchId: r.branchId,
    branchName: r.branch.name,
    code: r.code,
    name: r.name,
    location: r.location,
    notes: r.notes,
    isActive: r.isActive,
    productCount: summary?.productCount ?? 0,
    totalQty: summary?.totalQty ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function throwOnDupRack(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(
      "Kode rak sudah dipakai di cabang ini. Pilih kode lain.",
    );
  }
}
