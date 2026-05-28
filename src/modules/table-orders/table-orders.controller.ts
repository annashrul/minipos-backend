import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  ListTableOrdersQuerySchema,
  ListTableSessionsQuerySchema,
  PayCashierSchema,
  PublicProductsQuerySchema,
  PublicSessionQuerySchema,
  RejectTableOrderSchema,
  StartOnlinePaymentSchema,
  SubmitTableOrderSchema,
  type ListTableOrdersQueryDto,
  type ListTableSessionsQueryDto,
  type PayCashierDto,
  type PublicProductsQueryDto,
  type PublicSessionQueryDto,
  type RejectTableOrderDto,
  type StartOnlinePaymentDto,
  type SubmitTableOrderDto,
} from "./dto/table-orders.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { Public } from "@/modules/auth/public.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { TableOrdersService } from "./table-orders.service";

// ─────────────────────────────────────────────
// Public (tablet by qrToken) — no auth required
// ─────────────────────────────────────────────
@ApiTags("Table Orders")
@ApiBearerAuth()
@Controller("public/table-orders")
export class PublicTableOrdersController {
  constructor(private readonly service: TableOrdersService) {}

  @Public()
  @Get(":qrToken/info")
  @ApiOperation({ summary: "Get public table info" })
  async info(@Param("qrToken") qrToken: string) {
    const data = await this.service.getPublicTableInfo(qrToken);
    return { data };
  }

  @Public()
  @Get(":qrToken/catalog")
  @ApiOperation({ summary: "Get public catalog" })
  async catalog(@Param("qrToken") qrToken: string) {
    const data = await this.service.getPublicCatalog(qrToken);
    return { data };
  }

  @Public()
  @Get(":qrToken/products")
  @ApiOperation({ summary: "List public products" })
  @ApiZodQuery(PublicProductsQuerySchema)
  async products(
    @Param("qrToken") qrToken: string,
    @Query(new ZodValidationPipe(PublicProductsQuerySchema)) query: PublicProductsQueryDto,
  ) {
    const data = await this.service.getPublicProducts(qrToken, query);
    return { data };
  }

  @Public()
  @Get(":qrToken/products/:productId")
  @ApiOperation({ summary: "Get public product detail" })
  async productDetail(
    @Param("qrToken") qrToken: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.getPublicProductDetail(qrToken, productId);
    return { data };
  }

  @Public()
  @Get(":qrToken/session")
  @ApiOperation({ summary: "Get public active session" })
  @ApiZodQuery(PublicSessionQuerySchema)
  async session(
    @Param("qrToken") qrToken: string,
    @Query(new ZodValidationPipe(PublicSessionQuerySchema)) query: PublicSessionQueryDto,
  ) {
    const data = await this.service.getPublicActiveSession(qrToken, query);
    return { data };
  }

  @Public()
  @Post(":qrToken/orders")
  @ApiOperation({ summary: "Submit public table order" })
  @ApiZodBody(SubmitTableOrderSchema)
  async submit(
    @Param("qrToken") qrToken: string,
    @Body(new ZodValidationPipe(SubmitTableOrderSchema)) body: SubmitTableOrderDto,
  ) {
    const data = await this.service.submitOrder(qrToken, body);
    return { data };
  }

  @Public()
  @Post(":qrToken/sessions/:sessionId/pay-online")
  @ApiOperation({ summary: "Start online payment" })
  @ApiZodBody(StartOnlinePaymentSchema)
  async payOnline(
    @Param("qrToken") qrToken: string,
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(StartOnlinePaymentSchema)) body: StartOnlinePaymentDto,
  ) {
    const data = await this.service.startOnlinePayment(qrToken, sessionId, body);
    return { data };
  }
}

// ─────────────────────────────────────────────
// Authenticated (kasir / kitchen)
// ─────────────────────────────────────────────
@ApiTags("Table Orders")
@ApiBearerAuth()
@Controller("table-orders")
@UseGuards(AccessGuard)
export class TableOrdersController {
  constructor(private readonly service: TableOrdersService) {}

  @Get()
  @RequireAccess("table-orders", "view")
  @ApiOperation({ summary: "List table orders" })
  @ApiZodQuery(ListTableOrdersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTableOrdersQuerySchema)) query: ListTableOrdersQueryDto,
  ) {
    const data = await this.service.listOrders(companyId, query);
    return { data };
  }

  @Post(":id/approve")
  @RequireAccess("table-orders", "approve")
  @ApiOperation({ summary: "Approve table order" })
  async approve(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.service.approve(companyId, user.id, id);
    return { data };
  }

  @Post(":id/reject")
  @RequireAccess("table-orders", "reject")
  @ApiOperation({ summary: "Reject table order" })
  @ApiZodBody(RejectTableOrderSchema)
  async reject(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RejectTableOrderSchema)) body: RejectTableOrderDto,
  ) {
    const data = await this.service.reject(companyId, user.id, id, body.reason);
    return { data };
  }

  @Patch(":id/ready")
  @RequireAccess("table-orders", "update")
  @ApiOperation({ summary: "Mark table order ready" })
  async markReady(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.markOrderReady(companyId, id);
    return { data };
  }
}

@ApiTags("Table Orders")
@ApiBearerAuth()
@Controller("table-sessions")
@UseGuards(AccessGuard)
export class TableSessionsController {
  constructor(private readonly service: TableOrdersService) {}

  @Get()
  @RequireAccess("table-orders", "view")
  @ApiOperation({ summary: "List table sessions" })
  @ApiZodQuery(ListTableSessionsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTableSessionsQuerySchema)) query: ListTableSessionsQueryDto,
  ) {
    const data = await this.service.listSessions(companyId, query);
    return { data };
  }

  @Post(":id/pay-cashier")
  @RequireAccess("table-orders", "pay")
  @ApiOperation({ summary: "Pay table session by cashier" })
  @ApiZodBody(PayCashierSchema)
  async payCashier(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(PayCashierSchema)) body: PayCashierDto,
  ) {
    const data = await this.service.payByCashier(companyId, user.id, id, body);
    return { data };
  }

  @Post(":id/close")
  @RequireAccess("table-orders", "close_session")
  @ApiOperation({ summary: "Force close table session" })
  async forceClose(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.forceCloseSession(companyId, id);
    return { data };
  }

  @Post(":id/link-transaction")
  @RequireAccess("table-orders", "pay")
  @ApiOperation({ summary: "Link transaction and close session" })
  async linkTransaction(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body() body: { transactionId: string },
  ) {
    const data = await this.service.linkTransactionAndClose(
      companyId,
      id,
      body.transactionId,
    );
    return { data };
  }
}
