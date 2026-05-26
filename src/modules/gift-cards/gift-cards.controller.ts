import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { type AuthUser } from "@/contracts";
import {
  CreateGiftCardSchema,
  ListGiftCardsQuerySchema,
  RedeemGiftCardSchema,
  TopupGiftCardSchema,
  UpdateGiftCardSchema,
  type CreateGiftCardDto,
  type ListGiftCardsQueryDto,
  type RedeemGiftCardDto,
  type TopupGiftCardDto,
  type UpdateGiftCardDto,
} from "./dto/gift-cards.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { GiftCardsService } from "./gift-cards.service";

@Controller("gift-cards")
@UseGuards(AccessGuard)
export class GiftCardsController {
  constructor(private readonly giftCards: GiftCardsService) {}

  @Get()
  @RequireAccess("gift-cards", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListGiftCardsQuerySchema))
    query: ListGiftCardsQueryDto,
  ) {
    const data = await this.giftCards.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("gift-cards", "view")
  async stats(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.giftCards.stats(companyId, branchId);
    return { data };
  }

  @Get("by-code/:code")
  @RequireAccess("gift-cards", "view")
  async findByCode(
    @CurrentCompany() companyId: string,
    @Param("code") code: string,
  ) {
    const data = await this.giftCards.findByCode(companyId, code);
    return { data };
  }

  @Get(":id")
  @RequireAccess("gift-cards", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.giftCards.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("gift-cards", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateGiftCardSchema))
    body: CreateGiftCardDto,
  ) {
    const data = await this.giftCards.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/topup")
  @RequireAccess("gift-cards", "topup")
  async topup(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(TopupGiftCardSchema))
    body: TopupGiftCardDto,
  ) {
    const data = await this.giftCards.topup(companyId, id, body);
    return { data };
  }

  @Post(":id/redeem")
  @RequireAccess("gift-cards", "redeem")
  async redeem(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RedeemGiftCardSchema))
    body: RedeemGiftCardDto,
  ) {
    const data = await this.giftCards.redeem(companyId, id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("gift-cards", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateGiftCardSchema))
    body: UpdateGiftCardDto,
  ) {
    const data = await this.giftCards.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("gift-cards", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.giftCards.delete(companyId, id);
    return { data };
  }
}
