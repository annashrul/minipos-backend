import { Injectable } from "@nestjs/common";
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductListResponse,
  ProductResponse,
  UpdateProductDto,
} from "@/contracts";
import { ProductsCrudService } from "./internal/products-crud.service";
import { ProductsQueryService } from "./internal/products-query.service";

/**
 * Facade tipis. Delegasi:
 *  - ProductsCrudService  → list / findById / create / update / softDelete
 *                           (incl. syncProductModifierGroups + generateProductCode)
 *  - ProductsQueryService → stats / findByBarcode / topSelling / byCategory /
 *                           branchView / importTemplateData
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly crud: ProductsCrudService,
    private readonly query: ProductsQueryService,
  ) {}

  list(
    companyId: string,
    query: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    return this.crud.list(companyId, query);
  }
  findById(companyId: string, id: string): Promise<ProductResponse> {
    return this.crud.findById(companyId, id);
  }
  create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    return this.crud.create(companyId, dto);
  }
  update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.crud.update(companyId, id, dto);
  }
  softDelete(companyId: string, id: string): Promise<{ success: true }> {
    return this.crud.softDelete(companyId, id);
  }

  stats(companyId: string, branchId?: string) {
    return this.query.stats(companyId, branchId);
  }
  findByBarcode(companyId: string, barcode: string, branchId?: string) {
    return this.query.findByBarcode(companyId, barcode, branchId);
  }
  topSelling(companyId: string, limit?: number) {
    return this.query.topSelling(companyId, limit);
  }
  byCategory(companyId: string, categoryId: string) {
    return this.query.byCategory(companyId, categoryId);
  }
  branchView(
    companyId: string,
    params: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      isActive?: boolean;
      stockStatus?: string;
      limit?: number;
      offset?: number;
      onlyWithStock?: boolean;
    },
  ) {
    return this.query.branchView(companyId, params);
  }
  importTemplateData(companyId: string) {
    return this.query.importTemplateData(companyId);
  }
}
