import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  AdjustPointsSchema,
  EarnPointsSchema,
  ListPointHistoryQuerySchema,
  RedeemPointsSchema,
  type AdjustPointsDto,
  type EarnPointsDto,
  type ListPointHistoryQueryDto,
  type RedeemPointsDto,
} from "./dto/points.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { PointsService } from "./points.service";

@ApiTags("Points")
@ApiBearerAuth()
@Controller("points")
@UseGuards(AccessGuard)
export class PointsController {
  constructor(private readonly points: PointsService) {}

  @Get("customers/:customerId")
  @RequireAccess("points", "view")
  @ApiOperation({ summary: "Get customer points balance" })
  async getCustomerPoints(
    @CurrentCompany() companyId: string,
    @Param("customerId") customerId: string,
  ) {
    const data = await this.points.getCustomerPoints(companyId, customerId);
    return { data };
  }

  @Get("history")
  @RequireAccess("points", "view")
  @ApiOperation({ summary: "List point history" })
  @ApiZodQuery(ListPointHistoryQuerySchema)
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
  @ApiOperation({ summary: "Earn points" })
  @ApiZodBody(EarnPointsSchema)
  async earn(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(EarnPointsSchema)) body: EarnPointsDto,
  ) {
    const data = await this.points.earn(companyId, body);
    return { data };
  }

  @Post("redeem")
  @RequireAccess("points", "redeem")
  @ApiOperation({ summary: "Redeem points" })
  @ApiZodBody(RedeemPointsSchema)
  async redeem(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(RedeemPointsSchema)) body: RedeemPointsDto,
  ) {
    const data = await this.points.redeem(companyId, body);
    return { data };
  }

  @Post("adjust")
  @RequireAccess("points", "adjust")
  @ApiOperation({ summary: "Adjust points" })
  @ApiZodBody(AdjustPointsSchema)
  async adjust(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(AdjustPointsSchema)) body: AdjustPointsDto,
  ) {
    const data = await this.points.adjust(companyId, body);
    return { data };
  }
}
