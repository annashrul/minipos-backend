import { Module } from "@nestjs/common";
import { ReturnCreateService } from "./internal/return-create.service";
import { ReturnLifecycleService } from "./internal/return-lifecycle.service";
import { ReturnQueryService } from "./internal/return-query.service";
import { ReturnStockAdjuster } from "./internal/return-stock.adjuster";
import { ReturnsController } from "./returns.controller";
import { ReturnsService } from "./returns.service";

@Module({
  controllers: [ReturnsController],
  providers: [
    ReturnsService,
    ReturnQueryService,
    ReturnCreateService,
    ReturnLifecycleService,
    ReturnStockAdjuster,
  ],
  exports: [ReturnsService],
})
export class ReturnsModule {}
