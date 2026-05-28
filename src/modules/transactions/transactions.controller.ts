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
  CheckoutSchema,
  ListTransactionsQuerySchema,
  RefundTransactionSchema,
  TransactionStatsQuerySchema,
  VoidTransactionSchema,
  type CheckoutDto,
  type ListTransactionsQueryDto,
  type RefundTransactionDto,
  type TransactionStatsQueryDto,
  type VoidTransactionDto,
} from "./dto/transactions.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { TransactionsService } from "./transactions.service";

@ApiTags("Transactions")
@ApiBearerAuth()
@Controller("transactions")
@UseGuards(AccessGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @RequireAccess("transactions", "view")
  @ApiOperation({ summary: "List transactions" })
  @ApiZodQuery(ListTransactionsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTransactionsQuerySchema))
    query: ListTransactionsQueryDto,
  ) {
    const data = await this.transactions.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("transactions", "view")
  @ApiOperation({ summary: "Transaction stats" })
  @ApiZodQuery(TransactionStatsQuerySchema)
  async stats(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(TransactionStatsQuerySchema))
    query: TransactionStatsQueryDto,
  ) {
    const data = await this.transactions.stats(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("transactions", "view")
  @ApiOperation({ summary: "Get transaction by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transactions.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("pos", "create")
  @ApiOperation({ summary: "Checkout (create transaction)" })
  @ApiZodBody(CheckoutSchema)
  async checkout(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CheckoutSchema)) body: CheckoutDto,
  ) {
    const data = await this.transactions.checkout(companyId, user.id, body);
    return { data };
  }

  @Post(":id/void")
  @RequireAccess("transactions", "void")
  @ApiOperation({ summary: "Void transaction" })
  @ApiZodBody(VoidTransactionSchema)
  async void(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(VoidTransactionSchema))
    body: VoidTransactionDto,
  ) {
    const data = await this.transactions.voidTransaction(
      companyId,
      user.id,
      id,
      body.reason,
    );
    return { data };
  }

  @Post(":id/duplicate")
  @RequireAccess("transactions", "duplicate")
  @ApiOperation({ summary: "Duplicate transaction" })
  async duplicate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.transactions.duplicate(companyId, user.id, id);
    return { data };
  }

  @Post("draft")
  @RequireAccess("pos", "save_draft")
  @ApiOperation({ summary: "Create draft transaction" })
  @ApiZodBody(CheckoutSchema)
  async createDraft(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CheckoutSchema)) body: CheckoutDto,
  ) {
    const data = await this.transactions.createDraft(companyId, user.id, body);
    return { data };
  }

  @Delete("draft/:id")
  @RequireAccess("pos", "save_draft")
  @ApiOperation({ summary: "Delete draft transaction" })
  async deleteDraft(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transactions.deleteDraft(companyId, id);
    return { data };
  }

  @Post(":id/refund")
  @RequireAccess("transactions", "refund")
  @ApiOperation({ summary: "Refund transaction" })
  @ApiZodBody(RefundTransactionSchema)
  async refund(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RefundTransactionSchema))
    body: RefundTransactionDto,
  ) {
    const data = await this.transactions.refundTransaction(
      companyId,
      user.id,
      id,
      body.reason,
    );
    return { data };
  }
}
