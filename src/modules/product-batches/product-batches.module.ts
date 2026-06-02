import { Module } from "@nestjs/common";
import { RacksModule } from "@/modules/racks/racks.module";
import { ProductBatchesController } from "./product-batches.controller";
import { ProductBatchesService } from "./product-batches.service";
import { ProductBatchesRepository } from "./product-batches.repository";
import { ProductBatchHelperService } from "./product-batch-helper.service";

@Module({
  imports: [RacksModule],
  controllers: [ProductBatchesController],
  providers: [
    ProductBatchesService,
    ProductBatchesRepository,
    ProductBatchHelperService,
  ],
  // Helper di-export supaya modul purchases (receive) & transactions (checkout)
  // bisa capture/consume batch dalam transaksi DB mereka.
  exports: [ProductBatchesService, ProductBatchHelperService],
})
export class ProductBatchesModule {}
