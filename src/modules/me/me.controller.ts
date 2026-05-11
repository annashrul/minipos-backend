import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import {
  MeAccessMatrixQuerySchema,
  VerifyAuthorizationSchema,
  type AuthUser,
  type MeAccessMatrixQueryDto,
  type MeAccessMatrixResponse,
  type MeMenusResponse,
  type VerifyAuthorizationDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";

const UpdateBusinessUnitSchema = z.object({
  businessUnit: z.enum(["RETAIL", "BENGKEL", "RESTAURANT", "CAFE"]),
});
type UpdateBusinessUnitDto = z.infer<typeof UpdateBusinessUnitSchema>;
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { MeService } from "./me.service";
import { UsersService } from "../users/users.service";

@Controller("me")
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly usersService: UsersService,
  ) {}

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

  /**
   * Verify password otorisasi user yang sedang login. Dipanggil oleh
   * frontend sebelum eksekusi aksi sensitif (void, refund, hapus transaksi).
   * Return ok:true → frontend lanjut. ok:false dengan notSet:true → user
   * belum set password otorisasi, suruh ke profile.
   */
  @Post("verify-authorization")
  async verifyAuthorization(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(VerifyAuthorizationSchema))
    body: VerifyAuthorizationDto,
  ) {
    const result = await this.usersService.verifyAuthorization(
      user.id,
      body.authorizationPassword,
    );
    return { data: result };
  }
}
