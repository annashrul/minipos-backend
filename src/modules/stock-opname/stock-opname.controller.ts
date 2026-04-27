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
  CreateStockOpnameSchema,
  ListStockOpnameQuerySchema,
  SetOpnameItemsSchema,
  type AuthUser,
  type CreateStockOpnameDto,
  type ListStockOpnameQueryDto,
  type SetOpnameItemsDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { StockOpnameService } from "./stock-opname.service";

@Controller("stock-opname")
@UseGuards(AccessGuard)
export class StockOpnameController {
  constructor(private readonly opname: StockOpnameService) {}

  @Get()
  @RequireAccess("stock-opname", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListStockOpnameQuerySchema))
    query: ListStockOpnameQueryDto,
  ) {
    const data = await this.opname.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("stock-opname", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("stock-opname", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStockOpnameSchema))
    body: CreateStockOpnameDto,
  ) {
    const data = await this.opname.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/items")
  @RequireAccess("stock-opname", "update")
  async setItems(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetOpnameItemsSchema)) body: SetOpnameItemsDto,
  ) {
    const data = await this.opname.setItems(companyId, id, body);
    return { data };
  }

  @Patch(":id/start")
  @RequireAccess("stock-opname", "update")
  async start(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.start(companyId, id);
    return { data };
  }

  @Post(":id/complete")
  @RequireAccess("stock-opname", "complete")
  async complete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.opname.complete(companyId, user.id, id);
    return { data };
  }

  @Patch(":id/cancel")
  @RequireAccess("stock-opname", "cancel")
  async cancel(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.cancel(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("stock-opname", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.delete(companyId, id);
    return { data };
  }
}
