import { Module } from "@nestjs/common";
import { ImageSearchModule } from "@/modules/image-search/image-search.module";
import { ProductAiService } from "./product-ai.service";
import { ProductCreateUpdateService } from "./product-create-update.service";
import { ProductSearchService } from "./product-search.service";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

@Module({
  // ImageSearchModule meng-export ProductEmbeddingService — dipakai
  // ProductCreateUpdateService untuk meng-embed foto produk saat disimpan.
  imports: [ImageSearchModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductCreateUpdateService,
    ProductSearchService,
    ProductsRepository,
    ProductAiService,
  ],
  exports: [ProductsService, ProductSearchService],
})
export class ProductsModule {}

