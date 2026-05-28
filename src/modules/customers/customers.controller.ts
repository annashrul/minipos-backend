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
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  UpdateCustomerSchema,
  type CreateCustomerDto,
  type ListCustomersQueryDto,
  type UpdateCustomerDto,
} from "./dto/customers.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { CustomersService } from "./customers.service";

@ApiTags("Customers")
@ApiBearerAuth()
@Controller("customers")
@UseGuards(AccessGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequireAccess("customers", "view")
  @ApiOperation({ summary: "List customers" })
  @ApiZodQuery(ListCustomersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListCustomersQuerySchema))
    query: ListCustomersQueryDto,
  ) {
    const data = await this.customers.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("customers", "view")
  @ApiOperation({ summary: "Customer summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.customers.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("customers", "view")
  @ApiOperation({ summary: "Get customer by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.customers.findById(companyId, id);
    return { data };
  }

  @Post("bulk-delete")
  @RequireAccess("customers", "delete")
  @ApiOperation({ summary: "Bulk delete customers" })
  async bulkDelete(
    @CurrentCompany() companyId: string,
    @Body() body: { ids: string[] },
  ) {
    const data = await this.customers.bulkDelete(companyId, body.ids);
    return { data };
  }

  @Post()
  @RequireAccess("customers", "create")
  @ApiOperation({ summary: "Create customer" })
  @ApiZodBody(CreateCustomerSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateCustomerSchema)) body: CreateCustomerDto,
  ) {
    const data = await this.customers.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("customers", "update")
  @ApiOperation({ summary: "Update customer" })
  @ApiZodBody(UpdateCustomerSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCustomerSchema)) body: UpdateCustomerDto,
  ) {
    const data = await this.customers.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("customers", "delete")
  @ApiOperation({ summary: "Delete customer" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.customers.delete(companyId, id);
    return { data };
  }
}
