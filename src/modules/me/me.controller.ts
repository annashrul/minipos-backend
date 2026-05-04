import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import {
  MeAccessMatrixQuerySchema,
  type AuthUser,
  type MeAccessMatrixQueryDto,
  type MeAccessMatrixResponse,
  type MeMenusResponse,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";

const UpdateBusinessUnitSchema = z.object({
  businessUnit: z.enum(["RETAIL", "BENGKEL", "RESTAURANT", "CAFE"]),
});
type UpdateBusinessUnitDto = z.infer<typeof UpdateBusinessUnitSchema>;
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
    const data = await this.meService.getMenusForRole(
      user.role,
      user.companyId ?? null,
    );
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

  @Patch("company/business-unit")
  async updateBusinessUnit(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(UpdateBusinessUnitSchema))
    body: UpdateBusinessUnitDto,
  ) {
    const data = await this.meService.updateCompanyBusinessUnit(
      companyId,
      body.businessUnit,
    );
    return { data };
  }
}
