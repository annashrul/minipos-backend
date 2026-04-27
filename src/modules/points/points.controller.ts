import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AdjustPointsSchema,
  EarnPointsSchema,
  ListPointHistoryQuerySchema,
  RedeemPointsSchema,
  type AdjustPointsDto,
  type EarnPointsDto,
  type ListPointHistoryQueryDto,
  type RedeemPointsDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { PointsService } from "./points.service";

@Controller("points")
@UseGuards(AccessGuard)
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get("customers/:customerId")
  @RequireAccess("points", "view")
  async getCustomerPoints(
    @CurrentCompany() companyId: string,
    @Param("customerId") customerId: string,
  ) {
    const data = await this.points.getCustomerPoints(companyId, customerId);
    return { data };
  }

  @Get("history")
  @RequireAccess("points", "view")
  async listHistory(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPointHistoryQuerySchema))
    query: ListPointHistoryQueryDto,
  ) {
    const data = await this.points.listHistory(companyId, query);
    return { data };
  }

  @Post("earn")
  @RequireAccess("points", "earn")
  async earn(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(EarnPointsSchema)) body: EarnPointsDto,
  ) {
    const data = await this.points.earn(companyId, body);
    return { data };
  }

  @Post("redeem")
  @RequireAccess("points", "redeem")
  async redeem(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(RedeemPointsSchema)) body: RedeemPointsDto,
  ) {
    const data = await this.points.redeem(companyId, body);
    return { data };
  }

  @Post("adjust")
  @RequireAccess("points", "adjust")
  async adjust(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(AdjustPointsSchema)) body: AdjustPointsDto,
  ) {
    const data = await this.points.adjust(companyId, body);
    return { data };
  }
}
