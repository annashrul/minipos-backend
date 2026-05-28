import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import type { AuthUser } from "@/contracts";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { MarketplaceGrabService } from "./marketplace-grab.service";

@ApiTags("Marketplace Grab")
@ApiBearerAuth()
@Controller("marketplace/grab")
export class MarketplaceGrabController {
  constructor(private readonly service: MarketplaceGrabService) {}

  @Get("accounts")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "List Grab accounts" })
  async list(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("Tidak ada perusahaan");
    const accounts = await this.service.listAccounts(user.companyId);
    return { data: { accounts } };
  }

  @Post("accounts")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "Create Grab account" })
  async create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: { cookie: string; userAgent?: string; branchId?: string | null },
  ) {
    if (!user.companyId) throw new BadRequestException("Tidak ada perusahaan");
    const account = await this.service.saveAccount({
      companyId: user.companyId,
      branchId: body.branchId,
      cookie: body.cookie,
      userAgent: body.userAgent,
    });
    return { data: { account } };
  }

  @Delete("accounts/:id")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "Delete Grab account" })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("Tidak ada perusahaan");
    await this.service.deleteAccount(user.companyId, id);
    return { data: { ok: true } };
  }

  @Post("accounts/:id/sync")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "Sync Grab account data" })
  async sync(
    @Param("id") id: string,
    @Body() body: { dateFrom?: string; dateTo?: string },
  ) {
    const result = await this.service.syncAccount(id, body);
    return { data: result };
  }

  @Get("daily-reports")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "List Grab daily reports" })
  async dailyReports(
    @CurrentUser() user: AuthUser,
    @Query("accountId") accountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limit?: string,
  ) {
    if (!user.companyId) throw new BadRequestException("Tidak ada perusahaan");
    const reports = await this.service.listDailyReports(user.companyId, {
      accountId,
      dateFrom,
      dateTo,
      limit: limit ? Number(limit) : undefined,
    });
    return { data: { reports } };
  }

  @Get("orders")
  @UseGuards(AccessGuard)
  @ApiOperation({ summary: "List Grab orders" })
  async orders(
    @CurrentUser() user: AuthUser,
    @Query("accountId") accountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (!user.companyId) throw new BadRequestException("Tidak ada perusahaan");
    const orders = await this.service.listOrders(user.companyId, {
      accountId,
      dateFrom,
      dateTo,
      status,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
    return { data: { orders } };
  }
}
