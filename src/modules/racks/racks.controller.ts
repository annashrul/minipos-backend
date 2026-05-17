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
  AssignProductsToRackSchema,
  CreateRackSchema,
  ListRacksQuerySchema,
  SetRackStockSchema,
  TransferRackStockSchema,
  UpdateRackSchema,
  type AssignProductsToRackDto,
  type CreateRackDto,
  type ListRacksQueryDto,
  type SetRackStockDto,
  type TransferRackStockDto,
  type UpdateRackDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { RacksService } from "./racks.service";

@Controller("racks")
@UseGuards(AccessGuard)
export class RacksController {
  constructor(private readonly racks: RacksService) {}

  @Get()
  @RequireAccess("racks", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListRacksQuerySchema))
    query: ListRacksQueryDto,
  ) {
    const data = await this.racks.list(companyId, query);
    return { data };
  }

  @Get("product/:productId")
  @RequireAccess("racks", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.racks.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("racks", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateRackSchema)) body: CreateRackDto,
  ) {
    const data = await this.racks.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("racks", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.racks.delete(companyId, id);
    return { data };
  }

  @Post(":id/stock")
  @RequireAccess("racks", "update")
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
  async assignProducts(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignProductsToRackSchema))
    body: AssignProductsToRackDto,
  ) {
    const data = await this.racks.assignProducts(companyId, id, body);
    return { data };
  }
}
