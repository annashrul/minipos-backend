import { Module } from "@nestjs/common";
import { ProductAiService } from "./product-ai.service";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository, ProductAiService],
  exports: [ProductsService],
})
export class ProductsModule {}
