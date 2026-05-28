import {
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
import {
  GenerateVouchersSchema,
  ListVouchersQuerySchema,
  RedeemVoucherSchema,
  type GenerateVouchersDto,
  type ListVouchersQueryDto,
  type RedeemVoucherDto,
} from "./dto/vouchers.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { VouchersService } from "./vouchers.service";

@ApiTags("Vouchers")
@ApiBearerAuth()
@Controller("vouchers")
@UseGuards(AccessGuard)
export class VouchersController {
  constructor(private readonly vouchers: VouchersService) {}

  @Get()
  @RequireAccess("vouchers", "view")
  @ApiOperation({ summary: "List vouchers" })
  @ApiZodQuery(ListVouchersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListVouchersQuerySchema))
    query: ListVouchersQueryDto,
  ) {
    const data = await this.vouchers.list(companyId, query);
    return { data };
  }

  @Get("by-code/:code")
  @RequireAccess("vouchers", "view")
  @ApiOperation({ summary: "Get voucher by code" })
  async findByCode(
    @CurrentCompany() companyId: string,
    @Param("code") code: string,
  ) {
    const data = await this.vouchers.findByCode(companyId, code);
    return { data };
  }

  @Get(":id")
  @RequireAccess("vouchers", "view")
  @ApiOperation({ summary: "Get voucher by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vouchers.findById(companyId, id);
    return { data };
  }

  @Post("generate")
  @RequireAccess("vouchers", "generate")
  @ApiOperation({ summary: "Generate vouchers" })
  @ApiZodBody(GenerateVouchersSchema)
  async generate(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(GenerateVouchersSchema))
    body: GenerateVouchersDto,
  ) {
    const data = await this.vouchers.generate(companyId, body);
    return { data };
  }

  @Post(":id/redeem")
  @RequireAccess("vouchers", "redeem")
  @ApiOperation({ summary: "Redeem voucher" })
  @ApiZodBody(RedeemVoucherSchema)
  async redeem(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RedeemVoucherSchema))
    body: RedeemVoucherDto,
  ) {
    const data = await this.vouchers.redeem(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("vouchers", "delete")
  @ApiOperation({ summary: "Delete voucher" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.vouchers.delete(companyId, id);
    return { data };
  }
}
