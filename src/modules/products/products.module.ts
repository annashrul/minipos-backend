import { Module } from "@nestjs/common";
import { ProductAiService } from "./product-ai.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductAiService],
  exports: [ProductsService],
})
export class ProductsModule {}
