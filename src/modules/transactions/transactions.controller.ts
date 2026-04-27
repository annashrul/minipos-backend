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
} from "@/contracts";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { TransactionsService } from "./transactions.service";

@Controller("transactions")
@UseGuards(AccessGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @RequireAccess("transactions", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transactions.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("pos", "create")
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

  @Post(":id/refund")
  @RequireAccess("transactions", "refund")
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
