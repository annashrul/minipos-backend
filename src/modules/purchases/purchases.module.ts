import { Module } from "@nestjs/common";
import { PurchaseQueryService } from "./internal/purchase-query.service";
import { PurchaseReceivingService } from "./internal/purchase-receiving.service";
import { PurchaseWriteService } from "./internal/purchase-write.service";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

@Module({
  controllers: [PurchasesController],
  providers: [
    PurchasesService,
    PurchaseQueryService,
    PurchaseWriteService,
    PurchaseReceivingService,
  ],
  exports: [PurchasesService],
})
export class PurchasesModule {}
