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
import type { AuthUser } from "@/contracts";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { MarketplaceGrabService } from "./marketplace-grab.service";

@Controller("marketplace/grab")
export class MarketplaceGrabController {
  constructor(private readonly service: MarketplaceGrabService) {}

  @Get("accounts")
  @UseGuards(AccessGuard)
  async list(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("No company");
    const accounts = await this.service.listAccounts(user.companyId);
    return { data: { accounts } };
  }

  @Post("accounts")
  @UseGuards(AccessGuard)
  async create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: { cookie: string; userAgent?: string; branchId?: string | null },
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
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
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
    await this.service.deleteAccount(user.companyId, id);
    return { data: { ok: true } };
  }

  @Post("accounts/:id/sync")
  @UseGuards(AccessGuard)
  async sync(
    @Param("id") id: string,
    @Body() body: { dateFrom?: string; dateTo?: string },
  ) {
    const result = await this.service.syncAccount(id, body);
    return { data: result };
  }

  @Get("daily-reports")
  @UseGuards(AccessGuard)
  async dailyReports(
    @CurrentUser() user: AuthUser,
    @Query("accountId") accountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limit?: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
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
  async orders(
    @CurrentUser() user: AuthUser,
    @Query("accountId") accountId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (!user.companyId) throw new BadRequestException("No company");
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
