import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import type { AuthUser } from "@/contracts";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import {
  BatchStatsQuerySchema,
  BatchTraceQuerySchema,
  DisposeBatchSchema,
  ExpiringBatchesQuerySchema,
  ListBatchesQuerySchema,
  RecallBatchSchema,
  type BatchStatsQueryDto,
  type BatchTraceQueryDto,
  type DisposeBatchDto,
  type ExpiringBatchesQueryDto,
  type ListBatchesQueryDto,
  type RecallBatchDto,
} from "./dto/product-batches.dto";
import { ProductBatchesService } from "./product-batches.service";

@ApiTags("Product Batches")
@ApiBearerAuth()
@Controller("product-batches")
@UseGuards(AccessGuard)
export class ProductBatchesController {
  constructor(private readonly service: ProductBatchesService) {}

  @Get()
  @RequireAccess("product-batches", "view")
  @ApiOperation({ summary: "List batch produk (FEFO/traceability)" })
  @ApiZodQuery(ListBatchesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBatchesQuerySchema))
    query: ListBatchesQueryDto,
  ) {
    const data = await this.service.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("product-batches", "view")
  @ApiOperation({ summary: "Ringkasan KPI batch (aktif/expiring/expired)" })
  @ApiZodQuery(BatchStatsQuerySchema)
  async stats(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(BatchStatsQuerySchema))
    query: BatchStatsQueryDto,
  ) {
    const data = await this.service.stats(companyId, query);
    return { data };
  }

  @Get("expiring")
  @RequireAccess("product-batches", "view")
  @ApiOperation({ summary: "Batch mendekati / sudah kedaluwarsa" })
  @ApiZodQuery(ExpiringBatchesQuerySchema)
  async expiring(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ExpiringBatchesQuerySchema))
    query: ExpiringBatchesQueryDto,
  ) {
    const data = await this.service.expiring(companyId, query);
    return { data };
  }

  @Get("trace")
  @RequireAccess("product-batches", "view")
  @ApiOperation({
    summary: "Telusuri batch: penjualan & pelanggan terdampak (recall)",
  })
  @ApiZodQuery(BatchTraceQuerySchema)
  async trace(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(BatchTraceQuerySchema))
    query: BatchTraceQueryDto,
  ) {
    const data = await this.service.trace(companyId, query);
    return { data };
  }

  @Get(":id/movements")
  @RequireAccess("product-batches", "view")
  @ApiOperation({ summary: "Riwayat pergerakan satu batch" })
  async movements(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("perPage") perPage?: string,
  ) {
    const data = await this.service.movements(
      id,
      Number(page) > 0 ? Number(page) : 1,
      Number(perPage) > 0 ? Number(perPage) : 20,
    );
    return { data };
  }

  @Post("recall")
  @RequireAccess("product-batches", "update")
  @ApiOperation({ summary: "Tarik (recall) batch berdasarkan id/batchNumber" })
  async recall(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RecallBatchSchema)) dto: RecallBatchDto,
  ) {
    const data = await this.service.recall(companyId, user.id, dto);
    return { data };
  }

  @Post("dispose")
  @RequireAccess("product-batches", "update")
  @ApiOperation({ summary: "Buang (write-off) batch kedaluwarsa" })
  async dispose(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(DisposeBatchSchema)) dto: DisposeBatchDto,
  ) {
    const data = await this.service.dispose(companyId, user.id, dto);
    return { data };
  }
}
