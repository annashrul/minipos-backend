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
  CreateSupplierSchema,
  ListSuppliersQuerySchema,
  UpdateSupplierSchema,
  type CreateSupplierDto,
  type ListSuppliersQueryDto,
  type UpdateSupplierDto,
} from "./dto/suppliers.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { SuppliersService } from "./suppliers.service";

@ApiTags("Suppliers")
@ApiBearerAuth()
@Controller("suppliers")
@UseGuards(AccessGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequireAccess("suppliers", "view")
  @ApiOperation({ summary: "List suppliers" })
  @ApiZodQuery(ListSuppliersQuerySchema)
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
  @ApiOperation({ summary: "Suppliers summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.suppliers.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("suppliers", "view")
  @ApiOperation({ summary: "Get supplier by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.suppliers.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("suppliers", "delete")
  @ApiOperation({ summary: "Bulk delete suppliers" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.suppliers.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Post()
  @RequireAccess("suppliers", "create")
  @ApiOperation({ summary: "Create supplier" })
  @ApiZodBody(CreateSupplierSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateSupplierSchema)) body: CreateSupplierDto,
  ) {
    const data = await this.suppliers.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("suppliers", "update")
  @ApiOperation({ summary: "Update supplier" })
  @ApiZodBody(UpdateSupplierSchema)
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
  @ApiOperation({ summary: "Delete supplier" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.suppliers.delete(companyId, id);
    return { data };
  }
}
