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
  AssignProductsToRackSchema,
  CreateRackSchema,
  ListRackMovementsQuerySchema,
  ListRacksQuerySchema,
  ReportDiscrepancySchema,
  SetRackStockSchema,
  TransferRackStockSchema,
  UpdateRackSchema,
  type AssignProductsToRackDto,
  type CreateRackDto,
  type ListRackMovementsQueryDto,
  type ListRacksQueryDto,
  type ReportDiscrepancyDto,
  type SetRackStockDto,
  type TransferRackStockDto,
  type UpdateRackDto,
} from "./dto/racks.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { RacksService } from "./racks.service";

@ApiTags("Racks")
@ApiBearerAuth()
@Controller("racks")
@UseGuards(AccessGuard)
export class RacksController {
  constructor(private readonly racks: RacksService) {}

  @Get()
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "List racks" })
  @ApiZodQuery(ListRacksQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListRacksQuerySchema))
    query: ListRacksQueryDto,
  ) {
    const data = await this.racks.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "Racks summary" })
  async summary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.racks.summary(companyId, branchId);
    return { data };
  }

  @Get("product/:productId")
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "Lookup racks by product" })
  async productLookup(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.racks.productLookup(
      companyId,
      productId,
      branchId,
    );
    return { data };
  }

  @Get(":id")
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "Get rack by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.racks.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("racks", "delete")
  @ApiOperation({ summary: "Bulk delete racks" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.racks.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Post()
  @RequireAccess("racks", "create")
  @ApiOperation({ summary: "Create rack" })
  @ApiZodBody(CreateRackSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateRackSchema)) body: CreateRackDto,
  ) {
    const data = await this.racks.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Update rack" })
  @ApiZodBody(UpdateRackSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateRackSchema)) body: UpdateRackDto,
  ) {
    const data = await this.racks.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("racks", "delete")
  @ApiOperation({ summary: "Delete rack" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.racks.delete(companyId, id);
    return { data };
  }

  @Post(":id/stock")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Set rack stock" })
  @ApiZodBody(SetRackStockSchema)
  async setStock(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: { id: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetRackStockSchema)) body: SetRackStockDto,
  ) {
    const data = await this.racks.setStock(companyId, id, body, user.id);
    return { data };
  }

  @Post("transfer")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Transfer rack stock" })
  @ApiZodBody(TransferRackStockSchema)
  async transfer(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(TransferRackStockSchema))
    body: TransferRackStockDto,
  ) {
    const data = await this.racks.transfer(companyId, body, user.id);
    return { data };
  }

  @Post(":id/assign-products")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Assign products to rack" })
  @ApiZodBody(AssignProductsToRackSchema)
  async assignProducts(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignProductsToRackSchema))
    body: AssignProductsToRackDto,
  ) {
    const data = await this.racks.assignProducts(companyId, id, body);
    return { data };
  }

  @Get("movements/list")
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "List rack movements" })
  @ApiZodQuery(ListRackMovementsQuerySchema)
  async listMovements(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListRackMovementsQuerySchema))
    query: ListRackMovementsQueryDto,
  ) {
    const data = await this.racks.listMovements(companyId, query);
    return { data };
  }

  @Get("discrepancies/list")
  @RequireAccess("racks", "view")
  @ApiOperation({ summary: "List rack discrepancies" })
  async listDiscrepancies(
    @CurrentCompany() companyId: string,
    @Query("status") status?: "OPEN" | "RESOLVED",
  ) {
    const data = await this.racks.listDiscrepancies(companyId, status);
    return { data };
  }

  @Post("discrepancies/report")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Report rack discrepancy" })
  @ApiZodBody(ReportDiscrepancySchema)
  async reportDiscrepancy(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(ReportDiscrepancySchema))
    body: ReportDiscrepancyDto,
  ) {
    const data = await this.racks.reportDiscrepancy(companyId, user.id, body);
    return { data };
  }

  @Post("discrepancies/:id/resolve")
  @RequireAccess("racks", "update")
  @ApiOperation({ summary: "Resolve rack discrepancy" })
  async resolveDiscrepancy(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: { id: string },
    @Param("id") id: string,
    @Body() body: { applyAdjustment?: boolean },
  ) {
    const data = await this.racks.resolveDiscrepancy(
      companyId,
      user.id,
      id,
      body.applyAdjustment ?? false,
    );
    return { data };
  }
}
