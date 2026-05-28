import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  BulkDeleteGoodsReceiptsSchema,
  GoodsReceiptStatsQuerySchema,
  ListGoodsReceiptsQuerySchema,
  type BulkDeleteGoodsReceiptsDto,
  type GoodsReceiptStatsQueryDto,
  type ListGoodsReceiptsQueryDto,
} from "./dto/goods-receipts.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { GoodsReceiptsService } from "./goods-receipts.service";

@ApiTags("Goods Receipts")
@ApiBearerAuth()
@Controller("goods-receipts")
@UseGuards(AccessGuard)
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequireAccess("goods-receipts", "view")
  @ApiOperation({ summary: "List goods receipts" })
  @ApiZodQuery(ListGoodsReceiptsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListGoodsReceiptsQuerySchema))
    query: ListGoodsReceiptsQueryDto,
  ) {
    const data = await this.receipts.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("goods-receipts", "view")
  @ApiOperation({ summary: "Goods receipts stats" })
  @ApiZodQuery(GoodsReceiptStatsQuerySchema)
  async stats(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(GoodsReceiptStatsQuerySchema))
    query: GoodsReceiptStatsQueryDto,
  ) {
    const data = await this.receipts.stats(companyId, query);
    return { data };
  }

  @Get("by-po/:poId")
  @RequireAccess("goods-receipts", "view")
  @ApiOperation({ summary: "Get goods receipts by purchase order" })
  async byPo(
    @CurrentCompany() companyId: string,
    @Param("poId") poId: string,
  ) {
    const data = await this.receipts.findByPurchaseOrder(companyId, poId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("goods-receipts", "view")
  @ApiOperation({ summary: "Get goods receipt by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.receipts.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("goods-receipts", "delete")
  @ApiOperation({ summary: "Bulk delete goods receipts" })
  @ApiZodBody(BulkDeleteGoodsReceiptsSchema)
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(BulkDeleteGoodsReceiptsSchema))
    body: BulkDeleteGoodsReceiptsDto,
  ) {
    const data = await this.receipts.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("goods-receipts", "delete")
  @ApiOperation({ summary: "Delete goods receipt" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.receipts.delete(companyId, id);
    return { data };
  }
}
