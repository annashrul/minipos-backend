import { Module } from "@nestjs/common";
import { GoodsReceiptsController } from "./goods-receipts.controller";
import { GoodsReceiptsService } from "./goods-receipts.service";

@Module({
  controllers: [GoodsReceiptsController],
  providers: [GoodsReceiptsService],
  exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
