import { Module } from "@nestjs/common";
import { ProductsCrudService } from "./internal/products-crud.service";
import { ProductsQueryService } from "./internal/products-query.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsCrudService, ProductsQueryService],
  exports: [ProductsService],
})
export class ProductsModule {}
