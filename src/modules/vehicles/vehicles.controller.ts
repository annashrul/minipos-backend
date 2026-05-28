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
  CreateVehicleSchema,
  ListVehiclesQuerySchema,
  UpdateVehicleSchema,
  type CreateVehicleDto,
  type ListVehiclesQueryDto,
  type UpdateVehicleDto,
} from "./dto/vehicle.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { VehiclesService } from "./vehicles.service";

@ApiTags("Vehicles")
@ApiBearerAuth()
@Controller("vehicles")
@UseGuards(AccessGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequireAccess("vehicles", "view")
  @ApiOperation({ summary: "List vehicles" })
  @ApiZodQuery(ListVehiclesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListVehiclesQuerySchema))
    query: ListVehiclesQueryDto,
  ) {
    const data = await this.vehicles.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("vehicles", "view")
  @ApiOperation({ summary: "Get vehicle by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.findById(companyId, id);
    return { data };
  }

  @Get(":id/history")
  @RequireAccess("vehicles", "view")
  @ApiOperation({ summary: "Get vehicle service history" })
  async history(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.history(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("vehicles", "create")
  @ApiOperation({ summary: "Create vehicle" })
  @ApiZodBody(CreateVehicleSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateVehicleSchema)) body: CreateVehicleDto,
  ) {
    const data = await this.vehicles.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("vehicles", "update")
  @ApiOperation({ summary: "Update vehicle" })
  @ApiZodBody(UpdateVehicleSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateVehicleSchema)) body: UpdateVehicleDto,
  ) {
    const data = await this.vehicles.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("vehicles", "delete")
  @ApiOperation({ summary: "Delete vehicle" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.delete(companyId, id);
    return { data };
  }
}
