import { Controller, Get, Query } from "@nestjs/common";
import {
  MeAccessMatrixQuerySchema,
  type AuthUser,
  type MeAccessMatrixQueryDto,
  type MeAccessMatrixResponse,
  type MeMenusResponse,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { MeService } from "./me.service";

@Controller("me")
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return { data: user };
  }

  @Get("menus")
  async menus(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: MeMenusResponse }> {
    const data = await this.meService.getMenusForRole(user.role);
    return { data };
  }

  @Get("access-matrix")
  async accessMatrix(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(MeAccessMatrixQuerySchema))
    query: MeAccessMatrixQueryDto,
  ): Promise<{ data: MeAccessMatrixResponse }> {
    const data = await this.meService.getAccessMatrix(user.role, query.search);
    return { data };
  }

  @Get("default-route")
  async defaultRoute(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: { route: string } }> {
    const route = await this.meService.getDefaultRouteForRole(user.role);
    return { data: { route } };
  }

  @Get("company")
  async company(@CurrentCompany() companyId: string) {
    const data = await this.meService.getCompany(companyId);
    return { data };
  }

  @Get("company-with-limits")
  async companyWithLimits(@CurrentCompany() companyId: string) {
    const data = await this.meService.getCompanyWithUsage(companyId);
    return { data };
  }
}
