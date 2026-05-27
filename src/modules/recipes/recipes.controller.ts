import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  UpsertRecipeSchema,
  YieldEstimateQuerySchema,
  YieldSummaryQuerySchema,
  type UpsertRecipeDto,
  type YieldEstimateQueryDto,
  type YieldSummaryQueryDto,
} from "./dto/recipes.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { RecipesService } from "./recipes.service";

// Resep menempel ke produk → endpoint nested di bawah products. Reuse menu
// `products` untuk access control (tidak butuh menu baru).
@Controller("products/:productId/recipe")
@UseGuards(AccessGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequireAccess("products", "view")
  async get(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.recipes.getByProduct(companyId, productId);
    return { data };
  }

  @Put()
  @RequireAccess("products", "update")
  async upsert(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Body(new ZodValidationPipe(UpsertRecipeSchema)) body: UpsertRecipeDto,
  ) {
    const data = await this.recipes.upsert(companyId, productId, body);
    return { data };
  }

  @Delete()
  @RequireAccess("products", "update")
  async remove(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    await this.recipes.remove(companyId, productId);
    return { data: { ok: true } };
  }
}

// Company-wide endpoint untuk yield estimate (semua menu sekaligus).
@Controller("recipes")
@UseGuards(AccessGuard)
export class RecipesQueryController {
  constructor(private readonly recipes: RecipesService) {}

  @Get("yield-estimates")
  @RequireAccess("products", "view")
  async yieldEstimates(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(YieldEstimateQuerySchema))
    query: YieldEstimateQueryDto,
  ) {
    const data = await this.recipes.getYieldEstimates(companyId, query);
    return { data };
  }

  @Get("yield-summary")
  @RequireAccess("products", "view")
  async yieldSummary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(YieldSummaryQuerySchema))
    query: YieldSummaryQueryDto,
  ) {
    const data = await this.recipes.getYieldSummary(companyId, query.branchId);
    return { data };
  }
}
