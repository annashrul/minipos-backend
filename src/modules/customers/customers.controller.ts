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
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  UpdateCustomerSchema,
  type CreateCustomerDto,
  type ListCustomersQueryDto,
  type UpdateCustomerDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { CustomersService } from "./customers.service";

@Controller("customers")
@UseGuards(AccessGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequireAccess("customers", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListCustomersQuerySchema))
    query: ListCustomersQueryDto,
  ) {
    const data = await this.customers.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("customers", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.customers.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("customers", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateCustomerSchema)) body: CreateCustomerDto,
  ) {
    const data = await this.customers.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("customers", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.customers.delete(companyId, id);
    return { data };
  }
}
