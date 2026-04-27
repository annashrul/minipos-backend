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
import {
  BulkDeleteGoodsReceiptsSchema,
  GoodsReceiptStatsQuerySchema,
  ListGoodsReceiptsQuerySchema,
  type BulkDeleteGoodsReceiptsDto,
  type GoodsReceiptStatsQueryDto,
  type ListGoodsReceiptsQueryDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { GoodsReceiptsService } from "./goods-receipts.service";

@Controller("goods-receipts")
@UseGuards(AccessGuard)
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequireAccess("goods-receipts", "view")
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
  async byPo(
    @CurrentCompany() companyId: string,
    @Param("poId") poId: string,
  ) {
    const data = await this.receipts.findByPurchaseOrder(companyId, poId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("goods-receipts", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.receipts.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("goods-receipts", "delete")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.receipts.delete(companyId, id);
    return { data };
  }
}
