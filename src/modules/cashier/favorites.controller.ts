import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  CreateCashierFavoriteSchema,
  ReorderCashierFavoritesSchema,
  UpdateCashierFavoriteSchema,
  type AuthUser,
  type CreateCashierFavoriteDto,
  type ReorderCashierFavoritesDto,
  type UpdateCashierFavoriteDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { CashierService } from "./cashier.service";

@Controller("cashier/favorites")
@UseGuards(AccessGuard)
export class CashierFavoritesController {
  constructor(private readonly cashier: CashierService) {}

  @Get()
  async list(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.cashier.listFavorites(companyId, user.id);
    return { data };
  }

  @Get("user/:userId")
  async listForUser(
    @CurrentCompany() companyId: string,
    @Param("userId") userId: string,
  ) {
    const data = await this.cashier.listFavorites(companyId, userId);
    return { data };
  }

  @Post()
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCashierFavoriteSchema))
    body: CreateCashierFavoriteDto,
  ) {
    const data = await this.cashier.createFavorite(companyId, user.id, body);
    return { data };
  }

  @Put("reorder")
  async reorder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReorderCashierFavoritesSchema))
    body: ReorderCashierFavoritesDto,
  ) {
    const data = await this.cashier.reorderFavorites(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  async update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCashierFavoriteSchema))
    body: UpdateCashierFavoriteDto,
  ) {
    const data = await this.cashier.updateFavorite(
      companyId,
      user.id,
      id,
      body,
    );
    return { data };
  }

  @Delete(":id")
  async delete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.cashier.deleteFavorite(companyId, user.id, id);
    return { data };
  }
}
