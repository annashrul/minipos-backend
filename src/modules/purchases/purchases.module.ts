import { Module } from "@nestjs/common";
import { RacksModule } from "@/modules/racks/racks.module";
import { ProductBatchesModule } from "@/modules/product-batches/product-batches.module";
import { PurchasesController } from "./purchases.controller";
import { PurchaseReceiveService } from "./purchase-receive.service";
import { PurchasesRepository } from "./purchases.repository";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [RacksModule, ProductBatchesModule],
  controllers: [PurchasesController],
  providers: [PurchasesRepository, PurchaseReceiveService, PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
