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
  CreateSupplierSchema,
  ListSuppliersQuerySchema,
  UpdateSupplierSchema,
  type CreateSupplierDto,
  type ListSuppliersQueryDto,
  type UpdateSupplierDto,
} from "./dto/suppliers.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { SuppliersService } from "./suppliers.service";

@Controller("suppliers")
@UseGuards(AccessGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequireAccess("suppliers", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListSuppliersQuerySchema))
    query: ListSuppliersQueryDto,
  ) {
    const data = await this.suppliers.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("suppliers", "view")
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.suppliers.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("suppliers", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.suppliers.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("suppliers", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateSupplierSchema)) body: CreateSupplierDto,
  ) {
    const data = await this.suppliers.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("suppliers", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateSupplierSchema)) body: UpdateSupplierDto,
  ) {
    const data = await this.suppliers.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("suppliers", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.suppliers.delete(companyId, id);
    return { data };
  }
}
