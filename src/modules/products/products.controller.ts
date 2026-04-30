import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateProductSchema,
  ListProductsQuerySchema,
  UpdateProductSchema,
  type CreateProductDto,
  type ListProductsQueryDto,
  type UpdateProductDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ProductsService } from "./products.service";

@Controller("products")
@UseGuards(AccessGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequireAccess("products", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListProductsQuerySchema))
    query: ListProductsQueryDto,
  ) {
    const data = await this.products.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("products", "view")
  async stats(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.products.stats(companyId, branchId);
    return { data };
  }

  @Get("by-barcode")
  @RequireAccess("products", "view")
  async findByBarcode(
    @CurrentCompany() companyId: string,
    @Query("barcode") barcode: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.products.findByBarcode(companyId, barcode, branchId);
    return { data };
  }

  @Get("top-selling")
  @RequireAccess("products", "view")
  async topSelling(
    @CurrentCompany() companyId: string,
    @Query("limit") limit?: string,
  ) {
    const data = await this.products.topSelling(
      companyId,
      limit ? Number(limit) : 8,
    );
    return { data };
  }

  @Get("by-category/:categoryId")
  @RequireAccess("products", "view")
  async byCategory(
    @CurrentCompany() companyId: string,
    @Param("categoryId") categoryId: string,
  ) {
    const data = await this.products.byCategory(companyId, categoryId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("products", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.products.findById(companyId, id);
    return { data };
  }

  @Post("branch-view")
  @RequireAccess("products", "view")
  async branchView(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      isActive?: boolean;
      stockStatus?: string;
      limit?: number;
      offset?: number;
      onlyWithStock?: boolean;
      restrictToBranchAssigned?: boolean;
    },
  ) {
    const data = await this.products.branchView(companyId, body);
    return { data };
  }

  @Get("import-template-data")
  @RequireAccess("products", "view")
  async importTemplateData(@CurrentCompany() companyId: string) {
    const data = await this.products.importTemplateData(companyId);
    return { data };
  }

  @Post()
  @RequireAccess("products", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProductDto,
  ) {
    const data = await this.products.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("products", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProductDto,
  ) {
    const data = await this.products.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("products", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.products.softDelete(companyId, id);
    return { data };
  }
}
