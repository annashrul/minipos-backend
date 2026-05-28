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
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateCashierFavoriteSchema,
  ReorderCashierFavoritesSchema,
  UpdateCashierFavoriteSchema,
  type CreateCashierFavoriteDto,
  type ReorderCashierFavoritesDto,
  type UpdateCashierFavoriteDto,
} from "./dto/cashier.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { CashierService } from "./cashier.service";

@ApiTags("Cashier Favorites")
@ApiBearerAuth()
@Controller("cashier/favorites")
@UseGuards(AccessGuard)
export class CashierFavoritesController {
  constructor(private readonly cashier: CashierService) {}

  @Get()
  @ApiOperation({ summary: "List cashier favorites" })
  async list(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.cashier.listFavorites(companyId, user.id);
    return { data };
  }

  @Get("user/:userId")
  @ApiOperation({ summary: "List cashier favorites for user" })
  async listForUser(
    @CurrentCompany() companyId: string,
    @Param("userId") userId: string,
  ) {
    const data = await this.cashier.listFavorites(companyId, userId);
    return { data };
  }

  @Post()
  @ApiOperation({ summary: "Create cashier favorite" })
  @ApiZodBody(CreateCashierFavoriteSchema)
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
  @ApiOperation({ summary: "Reorder cashier favorites" })
  @ApiZodBody(ReorderCashierFavoritesSchema)
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
  @ApiOperation({ summary: "Update cashier favorite" })
  @ApiZodBody(UpdateCashierFavoriteSchema)
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
  @ApiOperation({ summary: "Delete cashier favorite" })
  async delete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.cashier.deleteFavorite(companyId, user.id, id);
    return { data };
  }
}
