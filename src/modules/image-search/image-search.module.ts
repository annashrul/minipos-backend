import { Module } from "@nestjs/common";
import { EmbeddingSweeperService } from "./embedding-sweeper.service";
import { ImageSearchController } from "./image-search.controller";
import { ImageSearchService } from "./image-search.service";
import { ProductEmbeddingService } from "./product-embedding.service";

// EmbeddingClient datang dari EmbeddingModule (@Global) dan PrismaService juga
// @Global — jadi module ini tidak perlu imports.
// ProductEmbeddingService di-export supaya ProductsModule bisa memanggilnya
// dari jalur create/update produk.
@Module({
  controllers: [ImageSearchController],
  providers: [
    ImageSearchService,
    ProductEmbeddingService,
    EmbeddingSweeperService,
  ],
  exports: [ProductEmbeddingService],
})
export class ImageSearchModule {}
