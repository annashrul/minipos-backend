import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { type AuthUser } from "@/contracts";
import {
  CashMovementSchema,
  CloseShiftSchema,
  ListShiftsQuerySchema,
  OpenShiftSchema,
  type CashMovementDto,
  type CloseShiftDto,
  type ListShiftsQueryDto,
  type OpenShiftDto,
} from "./dto/shifts.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ShiftsService } from "./shifts.service";

@Controller("shifts")
@UseGuards(AccessGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @RequireAccess("shifts", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListShiftsQuerySchema))
    query: ListShiftsQueryDto,
  ) {
    const data = await this.shifts.list(companyId, query);
    return { data };
  }

  @Get("current")
  async current(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.shifts.getCurrent(companyId, user.id);
    return { data };
  }

  @Get(":id")
  @RequireAccess("shifts", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.shifts.findById(companyId, id);
    return { data };
  }

  @Post("open")
  async open(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OpenShiftSchema)) body: OpenShiftDto,
  ) {
    const data = await this.shifts.open(companyId, user.id, body);
    return { data };
  }

  @Patch(":id/close")
  async close(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CloseShiftSchema)) body: CloseShiftDto,
  ) {
    const data = await this.shifts.close(companyId, user.id, id, body);
    return { data };
  }

  @Post(":id/cash-movements")
  async addMovement(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CashMovementSchema)) body: CashMovementDto,
  ) {
    const data = await this.shifts.addMovement(companyId, user.id, id, body);
    return { data };
  }
}
