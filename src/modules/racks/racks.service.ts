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
    // Phase 1: hitung dari Product.defaultRackId (rak default produk).
    // Phase 2 (qty per rak) akan tambah agregat dari RackStock.
    const products =
      rackIds.length > 0
        ? await this.prisma.product.groupBy({
            by: ["defaultRackId"],
            where: {
              defaultRackId: { in: rackIds },
              companyId,
            },
            _count: { id: true },
            _sum: { stock: true },
          })
        : [];

    const stockMap = new Map(
      products
        .filter((p) => p.defaultRackId)
        .map((p) => [
          p.defaultRackId as string,
          {
            productCount: p._count.id,
            totalQty: p._sum.stock ?? 0,
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

    // Phase 1: items dari Product.defaultRackId (qty pakai Product.stock).
    // Phase 2 (bin location) akan replace dengan RackStock breakdown.
    const products = await this.prisma.product.findMany({
      where: { defaultRackId: id, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        stock: true,
        imageUrl: true,
      },
      orderBy: { stock: "desc" },
    });

    const stockSummary = {
      productCount: products.length,
      totalQty: products.reduce((sum, p) => sum + p.stock, 0),
    };

    return {
      ...toRackResponse(rack, stockSummary),
      items: products.map((p) => ({
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        unit: p.unit,
        qty: p.stock,
        imageUrl: p.imageUrl,
        isDefaultRack: true,
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
