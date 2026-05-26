import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BundleItemInputDto,
  BundleResponse,
  CreateBundleDto,
  ListBundlesQueryDto,
  UpdateBundleDto,
} from "./dto/bundles.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

const BUNDLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  imageUrl: true,
  sellingPrice: true,
  totalBasePrice: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  barcode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          sellingPrice: true,
          purchasePrice: true,
        },
      },
      quantity: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.ProductBundleSelect;

type RawBundle = Prisma.ProductBundleGetPayload<{
  select: typeof BUNDLE_SELECT;
}>;

@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListBundlesQueryDto,
  ): Promise<PaginatedResponse<BundleResponse>> {
    const {
      search,
      categoryId,
      branchId,
      isActive,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;

    const where: Prisma.ProductBundleWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (branchId) where.branchId = branchId;
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.ProductBundleOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "code":
        case "name":
        case "sellingPrice":
        case "totalBasePrice":
        case "createdAt":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.ProductBundleOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.productBundle.findMany({
        where,
        select: BUNDLE_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.productBundle.count({ where }),
    ]);

    return paginate(rows.map(toBundleResponse), total, page, perPage);
  }

  async findById(companyId: string, id: string): Promise<BundleResponse> {
    const bundle = await this.prisma.productBundle.findFirst({
      where: { id, companyId },
      select: BUNDLE_SELECT,
    });
    if (!bundle) throw new NotFoundException("Bundle not found");
    return toBundleResponse(bundle);
  }

  async create(
    companyId: string,
    dto: CreateBundleDto,
  ): Promise<BundleResponse> {
    await this.assertReferences(
      companyId,
      dto.branchId ?? null,
      dto.categoryId ?? null,
      dto.items,
    );

    const totalBasePrice = await this.computeTotalBasePrice(dto.items);

    try {
      const created = await this.prisma.productBundle.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          sellingPrice: dto.sellingPrice,
          totalBasePrice,
          categoryId: dto.categoryId ?? null,
          branchId: dto.branchId ?? null,
          barcode: dto.barcode ?? null,
          isActive: dto.isActive ?? true,
          companyId,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sortOrder: i.sortOrder ?? 0,
            })),
          },
        },
        select: BUNDLE_SELECT,
      });
      this.realtime.emit(EVENTS.BUNDLE_UPDATED, { bundleId: created.id });
      return toBundleResponse(created);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateBundleDto,
  ): Promise<BundleResponse> {
    const existing = await this.prisma.productBundle.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Bundle not found");

    await this.assertReferences(
      companyId,
      dto.branchId ?? null,
      dto.categoryId ?? null,
      dto.items ?? null,
    );

    const data: Prisma.ProductBundleUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.items) {
          await tx.productBundleItem.deleteMany({ where: { bundleId: id } });
          data.totalBasePrice = await this.computeTotalBasePrice(dto.items);
          data.items = {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              sortOrder: i.sortOrder ?? 0,
            })),
          };
        }
        return tx.productBundle.update({
          where: { id },
          data,
          select: BUNDLE_SELECT,
        });
      });
      this.realtime.emit(EVENTS.BUNDLE_UPDATED, { bundleId: updated.id });
      return toBundleResponse(updated);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.productBundle.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Bundle not found");
    await this.prisma.productBundle.delete({ where: { id } });
    this.realtime.emit(EVENTS.BUNDLE_UPDATED, { bundleId: id });
    return { success: true };
  }

  private async assertReferences(
    companyId: string,
    branchId: string | null,
    categoryId: string | null,
    items: BundleItemInputDto[] | null,
  ) {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }
    if (categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: categoryId, companyId },
        select: { id: true },
      });
      if (!category) throw new NotFoundException("Category not found");
    }
    if (items && items.length > 0) {
      const productIds = items.map((i) => i.productId);
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (products.length !== new Set(productIds).size) {
        throw new NotFoundException(
          "Salah satu produk komponen tidak ditemukan",
        );
      }
    }
  }

  private async computeTotalBasePrice(
    items: BundleItemInputDto[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, sellingPrice: true },
    });
    const priceMap = new Map(products.map((p) => [p.id, p.sellingPrice]));
    return items.reduce(
      (s, i) => s + (priceMap.get(i.productId) ?? 0) * i.quantity,
      0,
    );
  }
}

function toBundleResponse(b: RawBundle): BundleResponse {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    description: b.description,
    imageUrl: b.imageUrl,
    sellingPrice: b.sellingPrice,
    totalBasePrice: b.totalBasePrice,
    categoryId: b.categoryId,
    category: b.category ? { id: b.category.id, name: b.category.name } : null,
    branchId: b.branchId,
    branch: b.branch ? { id: b.branch.id, name: b.branch.name } : null,
    barcode: b.barcode,
    isActive: b.isActive,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    items: b.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      product: i.product
        ? {
            id: i.product.id,
            code: i.product.code,
            name: i.product.name,
            sellingPrice: i.product.sellingPrice,
            purchasePrice: i.product.purchasePrice,
          }
        : null,
      quantity: i.quantity,
      sortOrder: i.sortOrder,
    })),
  };
}

function throwOnDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Kode atau barcode bundle sudah digunakan");
  }
}
