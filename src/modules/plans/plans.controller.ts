import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ListPlanAccessQuerySchema,
  PlanCheckQuerySchema,
  SetPlanActionAccessSchema,
  SetPlanMenuAccessSchema,
  UpdatePlanAccessSchema,
  type ListPlanAccessQueryDto,
  type PlanCheckQueryDto,
  type SetPlanActionAccessDto,
  type SetPlanMenuAccessDto,
  type UpdatePlanAccessDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { RequireAccess } from "../auth/require-access.decorator";
import { PlansService } from "./plans.service";

@Controller("plans")
@UseGuards(AccessGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get("menu-access")
  @RequireAccess("plans", "view")
  async listMenuAccess(
    @Query(new ZodValidationPipe(ListPlanAccessQuerySchema))
    query: ListPlanAccessQueryDto,
  ) {
    const data = await this.plans.listMenuAccess(query);
    return { data };
  }

  @Put("menu-access")
  @RequireAccess("plans", "update")
  async setMenuAccess(
    @Body(new ZodValidationPipe(SetPlanMenuAccessSchema))
    body: SetPlanMenuAccessDto,
  ) {
    const data = await this.plans.setMenuAccess(body);
    return { data };
  }

  @Patch("menu-access/:id")
  @RequireAccess("plans", "update")
  async updateMenuAccess(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePlanAccessSchema))
    body: UpdatePlanAccessDto,
  ) {
    const data = await this.plans.updateMenuAccess(id, body);
    return { data };
  }

  @Get("action-access")
  @RequireAccess("plans", "view")
  async listActionAccess(
    @Query(new ZodValidationPipe(ListPlanAccessQuerySchema))
    query: ListPlanAccessQueryDto,
  ) {
    const data = await this.plans.listActionAccess(query);
    return { data };
  }

  @Put("action-access")
  @RequireAccess("plans", "update")
  async setActionAccess(
    @Body(new ZodValidationPipe(SetPlanActionAccessSchema))
    body: SetPlanActionAccessDto,
  ) {
    const data = await this.plans.setActionAccess(body);
    return { data };
  }

  @Patch("action-access/:id")
  @RequireAccess("plans", "update")
  async updateActionAccess(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePlanAccessSchema))
    body: UpdatePlanAccessDto,
  ) {
    const data = await this.plans.updateActionAccess(id, body);
    return { data };
  }

  @Get("check")
  async check(
    @Query(new ZodValidationPipe(PlanCheckQuerySchema))
    query: PlanCheckQueryDto,
  ) {
    const data = await this.plans.check(query);
    return { data };
  }

  @Get("comparison")
  @RequireAccess("plans", "view")
  async comparison() {
    const data = await this.plans.comparison();
    return { data };
  }
}
