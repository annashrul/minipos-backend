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
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateProductSchema,
  GenerateProductDescriptionSchema,
  ListProductsQuerySchema,
  UpdateProductSchema,
  type CreateProductDto,
  type GenerateProductDescriptionDto,
  type ListProductsQueryDto,
  type UpdateProductDto,
} from "./dto/products.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ProductAiService } from "./product-ai.service";
import { ProductsService } from "./products.service";

@ApiTags("Products")
@ApiBearerAuth()
@Controller("products")
@UseGuards(AccessGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly ai: ProductAiService,
  ) {}

  @Get()
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "List products" })
  @ApiZodQuery(ListProductsQuerySchema)
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
  @ApiOperation({ summary: "Product stats" })
  async stats(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.products.stats(companyId, branchId);
    return { data };
  }

  @Get("by-barcode")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Find product by barcode" })
  async findByBarcode(
    @CurrentCompany() companyId: string,
    @Query("barcode") barcode: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.products.findByBarcode(companyId, barcode, branchId);
    return { data };
  }

  // Generate barcode unik EAN-13 untuk pre-fill input saat user click tombol
   // generate. Tidak menyimpan apapun — hanya return string. Dipakai di form
   // produk & form satuan. Action: "generate_barcode" (di-grant ke role yang
   // punya "update" via migration phase22).
  @Get("generate-barcode")
  @RequireAccess("products", "generate_barcode")
  @ApiOperation({ summary: "Generate unique barcode" })
  async generateBarcode(
    @CurrentCompany() companyId: string,
    @Query("prefix") prefix?: string,
  ) {
    const barcode = await this.products.generateUniqueBarcode(
      companyId,
      prefix,
    );
    return { data: { barcode } };
  }

  // Generate kode produk unik (preview hasil DB trigger sebelum INSERT).
  @Get("generate-code")
  @RequireAccess("products", "generate_code")
  @ApiOperation({ summary: "Generate unique product code" })
  async generateCode(@CurrentCompany() companyId: string) {
    const code = await this.products.generateUniqueProductCode(companyId);
    return { data: { code } };
  }

  @Get("top-selling")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "List top-selling products" })
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
  @ApiOperation({ summary: "List products by category" })
  async byCategory(
    @CurrentCompany() companyId: string,
    @Param("categoryId") categoryId: string,
  ) {
    const data = await this.products.byCategory(companyId, categoryId);
    return { data };
  }

  @Post("pos-search")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Search products for POS" })
  async posSearch(
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      limit?: number;
      offset?: number;
      restrictToBranchAssigned?: boolean;
    },
  ) {
    const data = await this.products.posSearch(companyId, body);
    return { data };
  }

  @Get(":id")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Get product by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.products.findById(companyId, id);
    return { data };
  }

  // Single-API GET untuk product form: return product + units + variants +
  // branchSkus + tierPrices + modifierGroupIds dalam satu response. Frontend
  // pakai ini untuk hindari race condition di multi-fetch flow.
  @Get(":id/detail")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Get product detail with extensions" })
  async findDetail(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.products.findDetail(companyId, id, branchId);
    return { data };
  }

  @Post("branch-view")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Branch product view" })
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
      sortBy?: string;
      sortDir?: "asc" | "desc";
      onlyWithStock?: boolean;
      restrictToBranchAssigned?: boolean;
      excludeIngredient?: boolean;
      excludeRecipeProducts?: boolean;
      itemType?: "PRODUCT" | "SERVICE" | "INGREDIENT";
    },
  ) {
    const data = await this.products.branchView(companyId, body);
    return { data };
  }

  @Get("import-template-data")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Get import template reference data" })
  async importTemplateData(@CurrentCompany() companyId: string) {
    const data = await this.products.importTemplateData(companyId);
    return { data };
  }

  @Post()
  @RequireAccess("products", "create")
  @ApiOperation({ summary: "Create product" })
  @ApiZodBody(CreateProductSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateProductSchema)) body: CreateProductDto,
  ) {
    const data = await this.products.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("products", "update")
  @ApiOperation({ summary: "Update product" })
  @ApiZodBody(UpdateProductSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateProductSchema)) body: UpdateProductDto,
  ) {
    const data = await this.products.update(companyId, id, body);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("products", "delete")
  @ApiOperation({ summary: "Bulk delete products" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.products.bulkSoftDelete(companyId, body.ids);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("products", "delete")
  @ApiOperation({ summary: "Delete product" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.products.softDelete(companyId, id);
    return { data };
  }

  @Post("ai/generate-description")
  @RequireAccess("products", "view")
  @ApiOperation({ summary: "Generate AI product description" })
  @ApiZodBody(GenerateProductDescriptionSchema)
  async generateDescription(
    @Body(new ZodValidationPipe(GenerateProductDescriptionSchema))
    body: GenerateProductDescriptionDto,
  ) {
    const data = await this.ai.generateDescription(body);
    return { data };
  }
}
