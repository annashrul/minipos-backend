import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { z } from "zod";
import { type AuthUser } from "@/contracts";
import {
  MeAccessMatrixQuerySchema,
  type MeAccessMatrixQueryDto,
  type MeAccessMatrixResponse,
  type MeMenusResponse,
} from "./dto/me.dto";
import {
  VerifyAuthorizationSchema,
  type VerifyAuthorizationDto,
} from "@/modules/users/dto/users.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";

const UpdateBusinessUnitSchema = z.object({
  businessUnit: z.enum(["RETAIL", "BENGKEL", "RESTAURANT", "CAFE", "APOTEK"]),
});
type UpdateBusinessUnitDto = z.infer<typeof UpdateBusinessUnitSchema>;
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { MeService } from "./me.service";
import { UsersService } from "@/modules/users/users.service";

@ApiTags("Me")
@ApiBearerAuth()
@Controller("me")
export class MeController {
  constructor(
    private readonly meService: MeService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get current user" })
  me(@CurrentUser() user: AuthUser) {
    return { data: user };
  }

  @Get("menus")
  @ApiOperation({ summary: "Get current user menus" })
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
  @ApiOperation({ summary: "Get access matrix" })
  @ApiZodQuery(MeAccessMatrixQuerySchema)
  async accessMatrix(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(MeAccessMatrixQuerySchema))
    query: MeAccessMatrixQueryDto,
  ): Promise<{ data: MeAccessMatrixResponse }> {
    const data = await this.meService.getAccessMatrix(user.role, query.search);
    return { data };
  }

  @Get("default-route")
  @ApiOperation({ summary: "Get default route for current user" })
  async defaultRoute(
    @CurrentUser() user: AuthUser,
  ): Promise<{ data: { route: string } }> {
    const route = await this.meService.getDefaultRouteForRole(user.role);
    return { data: { route } };
  }

  @Get("company")
  @ApiOperation({ summary: "Get current company" })
  async company(@CurrentCompany() companyId: string) {
    const data = await this.meService.getCompany(companyId);
    return { data };
  }

  @Get("company-with-limits")
  @ApiOperation({ summary: "Get current company with usage limits" })
  async companyWithLimits(@CurrentCompany() companyId: string) {
    const data = await this.meService.getCompanyWithUsage(companyId);
    return { data };
  }

  @Patch("company/business-unit")
  @ApiOperation({ summary: "Update company business unit" })
  @ApiZodBody(UpdateBusinessUnitSchema)
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
  @ApiOperation({ summary: "Verify authorization password" })
  @ApiZodBody(VerifyAuthorizationSchema)
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
