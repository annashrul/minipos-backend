import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateBranchPriceSchema,
  ListBranchPricesQuerySchema,
  ReplaceBranchPricesSchema,
  UpdateBranchPriceSchema,
  type CreateBranchPriceDto,
  type ListBranchPricesQueryDto,
  type ReplaceBranchPricesDto,
  type UpdateBranchPriceDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ProductExtensionsService } from "./product-extensions.service";

@Controller()
@UseGuards(AccessGuard)
export class BranchPricesController {
  constructor(private readonly service: ProductExtensionsService) {}

  @Get("branch-prices")
  @RequireAccess("branch-prices", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBranchPricesQuerySchema))
    query: ListBranchPricesQueryDto,
  ) {
    const data = await this.service.listBranchPrices(companyId, query);
    return { data };
  }

  @Get("products/:productId/branch-prices")
  @RequireAccess("branch-prices", "view")
  async listForProduct(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listBranchPricesForProduct(
      companyId,
      productId,
    );
    return { data };
  }

  @Post("products/:productId/branch-prices")
  @RequireAccess("branch-prices", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(CreateBranchPriceSchema))
    body: CreateBranchPriceDto,
  ) {
    const data = await this.service.createBranchPrice(
      companyId,
      productId,
      body,
    );
    return { data };
  }

  @Patch("products/:productId/branch-prices/:id")
  @RequireAccess("branch-prices", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBranchPriceSchema))
    body: UpdateBranchPriceDto,
  ) {
    const data = await this.service.updateBranchPrice(
      companyId,
      productId,
      id,
      body,
    );
    return { data };
  }

  @Delete("products/:productId/branch-prices/:id")
  @RequireAccess("branch-prices", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.deleteBranchPrice(
      companyId,
      productId,
      id,
    );
    return { data };
  }

  @Put("products/:productId/branch-prices")
  @RequireAccess("branch-prices", "update")
  async replace(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(ReplaceBranchPricesSchema))
    body: ReplaceBranchPricesDto,
  ) {
    const data = await this.service.replaceBranchPrices(
      companyId,
      productId,
      body,
    );
    return { data };
  }
}
