import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { StockService } from "@/modules/stock/stock.service";
import { StockUsageRepository, type RawUsageList } from "./stock-usage.repository";
import type {
  CreateStockUsageDto,
  ListStockUsageQueryDto,
  StockUsageResponse,
} from "./dto/stock-usage.dto";

@Injectable()
export class StockUsageService {
  constructor(
    private readonly repo: StockUsageRepository,
    private readonly stock: StockService,
  ) {}

  async list(
    companyId: string,
    query: ListStockUsageQueryDto,
  ): Promise<PaginatedResponse<StockUsageResponse>> {
    const { branchId, search, from, to, page, perPage } = query;
    const where: Prisma.StockUsageWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { usageNumber: { contains: search, mode: "insensitive" } },
        { requestedBy: { contains: search, mode: "insensitive" } },
        { purpose: { contains: search, mode: "insensitive" } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await this.repo.findMany(
      where,
      (page - 1) * perPage,
      perPage,
    );
    return paginate(rows.map(toListResponse), total, page, perPage);
  }

  async findOne(companyId: string, id: string): Promise<StockUsageResponse> {
    const row = await this.repo.findOne(id, companyId);
    if (!row) throw new NotFoundException("Dokumen pemakaian tidak ditemukan");
    return {
      id: row.id,
      usageNumber: row.usageNumber,
      branchId: row.branchId,
      branch: row.branch,
      requestedBy: row.requestedBy,
      purpose: row.purpose,
      woNumber: row.woNumber,
      notes: row.notes,
      status: row.status,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      itemCount: row.items.length,
      totalQty: row.items.reduce((s, it) => s + it.quantity, 0),
      items: row.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        product: it.product,
        variantId: it.variantId,
        unitId: it.unitId,
        rackId: it.rackId,
        quantity: it.quantity,
        baseQuantity: it.baseQuantity,
        notes: it.notes,
      })),
    };
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateStockUsageDto,
  ): Promise<StockUsageResponse> {
    const branch = await this.repo.findBranch(dto.branchId, companyId);
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");

    // Pra-validasi ketersediaan stok (agregat per produk) supaya tidak terjadi
    // pemotongan sebagian saat ada baris yang stoknya kurang.
    const requiredBase = new Map<string, number>();
    for (const it of dto.items) {
      let conversion = 1;
      if (it.unitId) {
        const unit = await this.repo.findProductUnit(it.unitId, it.productId);
        if (!unit) throw new NotFoundException("Satuan produk tidak ditemukan");
        conversion = unit.conversionQty ?? 1;
      }
      const base = it.quantity * conversion;
      requiredBase.set(it.productId, (requiredBase.get(it.productId) ?? 0) + base);
    }
    for (const [productId, needed] of requiredBase) {
      const bs = await this.repo.findBranchStock(dto.branchId, productId);
      const avail = bs?.quantity ?? 0;
      if (avail < needed) {
        throw new BadRequestException(
          `Stok tidak mencukupi untuk salah satu komponen (butuh ${needed}, tersedia ${avail})`,
        );
      }
    }

    const usageNumber = await this.generateNumber(companyId);
    const noteBase = `Pemakaian ${usageNumber} · ${dto.requestedBy}${
      dto.purpose ? ` · ${dto.purpose}` : ""
    }`;

    const header = await this.repo.createHeader({
      usageNumber,
      companyId,
      branch: { connect: { id: dto.branchId } },
      requestedBy: dto.requestedBy,
      purpose: dto.purpose ?? null,
      woNumber: dto.woNumber ?? null,
      notes: dto.notes ?? null,
      status: "COMPLETED",
      createdBy: userId,
    });

    // Potong stok per baris lewat StockService.adjust (rak FIFO/spesifik,
    // branchStock, productBranchSku, kartu stok MANUAL_OUT) — ditandai sebagai
    // refType 'stock_usage' & ter-link ke dokumen ini.
    for (const it of dto.items) {
      const movement = await this.stock.adjust(
        companyId,
        userId,
        {
          productId: it.productId,
          branchId: dto.branchId,
          type: "OUT",
          quantity: it.quantity,
          unitId: it.unitId ?? null,
          variantId: it.variantId ?? null,
          rackId: it.rackId ?? null,
          note: it.notes ? `${noteBase} · ${it.notes}` : noteBase,
          reference: usageNumber,
        },
        { refType: "stock_usage", refId: header.id },
      );
      await this.repo.createItem({
        stockUsageId: header.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        unitId: it.unitId ?? null,
        rackId: it.rackId ?? null,
        quantity: it.quantity,
        // movement.quantity = qty dalam satuan dasar (baseQuantity).
        baseQuantity: movement.quantity,
        notes: it.notes ?? null,
      });
    }

    return this.findOne(companyId, header.id);
  }

  // Nomor dokumen: PMK-YYYYMMDD-NNNN, sequence reset per company per hari.
  private async generateNumber(companyId: string): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const prefix = `PMK-${yyyy}${mm}${dd}-`;
    const count = await this.repo.countByNumberPrefix(companyId, prefix);
    return `${prefix}${String(count + 1).padStart(4, "0")}`;
  }
}

function toListResponse(row: RawUsageList): StockUsageResponse {
  return {
    id: row.id,
    usageNumber: row.usageNumber,
    branchId: row.branchId,
    branch: row.branch,
    requestedBy: row.requestedBy,
    purpose: row.purpose,
    woNumber: row.woNumber,
    notes: row.notes,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    itemCount: row.items.length,
    totalQty: row.items.reduce((s, it) => s + it.quantity, 0),
  };
}
