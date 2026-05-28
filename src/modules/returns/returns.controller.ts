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
  CreateReturnSchema,
  ListReturnsQuerySchema,
  RejectReturnSchema,
  SearchExchangeProductsQuerySchema,
  SearchReturnTransactionQuerySchema,
  type CreateReturnDto,
  type ListReturnsQueryDto,
  type RejectReturnDto,
  type SearchExchangeProductsQueryDto,
  type SearchReturnTransactionQueryDto,
} from "./dto/returns.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ReturnsService } from "./returns.service";

@ApiTags("Returns")
@ApiBearerAuth()
@Controller("returns")
@UseGuards(AccessGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @RequireAccess("returns", "view")
  @ApiOperation({ summary: "List returns" })
  @ApiZodQuery(ListReturnsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListReturnsQuerySchema))
    query: ListReturnsQueryDto,
  ) {
    const data = await this.returns.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("returns", "view")
  @ApiOperation({ summary: "Returns summary" })
  @ApiZodQuery(ListReturnsQuerySchema)
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListReturnsQuerySchema))
    query: ListReturnsQueryDto,
  ) {
    const data = await this.returns.summary(companyId, query);
    return { data };
  }

  @Get("transactions/search")
  @RequireAccess("returns", "create")
  @ApiOperation({ summary: "Search transaction eligible for return" })
  @ApiZodQuery(SearchReturnTransactionQuerySchema)
  async searchTransaction(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(SearchReturnTransactionQuerySchema))
    query: SearchReturnTransactionQueryDto,
  ) {
    const data = await this.returns.searchTransactionForReturn(
      companyId,
      query,
    );
    return { data };
  }

  @Get("products/search")
  @RequireAccess("returns", "create")
  @ApiOperation({ summary: "Search products for exchange" })
  @ApiZodQuery(SearchExchangeProductsQuerySchema)
  async searchProducts(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(SearchExchangeProductsQuerySchema))
    query: SearchExchangeProductsQueryDto,
  ) {
    const data = await this.returns.searchProductsForExchange(
      companyId,
      query,
    );
    return { data };
  }

  @Get(":id")
  @RequireAccess("returns", "view")
  @ApiOperation({ summary: "Get return by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.returns.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("returns", "create")
  @ApiOperation({ summary: "Create return" })
  @ApiZodBody(CreateReturnSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateReturnSchema)) body: CreateReturnDto,
  ) {
    const data = await this.returns.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id/approve")
  @RequireAccess("returns", "approve")
  @ApiOperation({ summary: "Approve return" })
  async approve(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.returns.approve(companyId, user.id, id);
    return { data };
  }

  @Patch(":id/reject")
  @RequireAccess("returns", "reject")
  @ApiOperation({ summary: "Reject return" })
  @ApiZodBody(RejectReturnSchema)
  async reject(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RejectReturnSchema)) body: RejectReturnDto,
  ) {
    const data = await this.returns.reject(companyId, user.id, id, body);
    return { data };
  }

  @Post(":id/complete")
  @RequireAccess("returns", "complete")
  @ApiOperation({ summary: "Complete return" })
  async complete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.returns.complete(companyId, user.id, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("returns", "delete")
  @ApiOperation({ summary: "Delete return" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.returns.delete(companyId, id);
    return { data };
  }
}
