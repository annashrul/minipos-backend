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
  CreateVehicleSchema,
  ListVehiclesQuerySchema,
  UpdateVehicleSchema,
  type CreateVehicleDto,
  type ListVehiclesQueryDto,
  type UpdateVehicleDto,
} from "./dto/vehicle.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { VehiclesService } from "./vehicles.service";

@Controller("vehicles")
@UseGuards(AccessGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequireAccess("vehicles", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.findById(companyId, id);
    return { data };
  }

  @Get(":id/history")
  @RequireAccess("vehicles", "view")
  async history(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.history(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("vehicles", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateVehicleSchema)) body: CreateVehicleDto,
  ) {
    const data = await this.vehicles.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("vehicles", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vehicles.delete(companyId, id);
    return { data };
  }
}
