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
import {
  ListTableOrdersQuerySchema,
  ListTableSessionsQuerySchema,
  PayCashierSchema,
  PublicProductsQuerySchema,
  RejectTableOrderSchema,
  StartOnlinePaymentSchema,
  SubmitTableOrderSchema,
  type ListTableOrdersQueryDto,
  type ListTableSessionsQueryDto,
  type PayCashierDto,
  type PublicProductsQueryDto,
  type RejectTableOrderDto,
  type StartOnlinePaymentDto,
  type SubmitTableOrderDto,
  type AuthUser,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { TableOrdersService } from "./table-orders.service";

// ─────────────────────────────────────────────
// Public (tablet by qrToken) — no auth required
// ─────────────────────────────────────────────
@Controller("public/table-orders")
export class PublicTableOrdersController {
  constructor(private readonly service: TableOrdersService) {}

  @Public()
  @Get(":qrToken/info")
  async info(@Param("qrToken") qrToken: string) {
    const data = await this.service.getPublicTableInfo(qrToken);
    return { data };
  }

  @Public()
  @Get(":qrToken/catalog")
  async catalog(@Param("qrToken") qrToken: string) {
    const data = await this.service.getPublicCatalog(qrToken);
    return { data };
  }

  @Public()
  @Get(":qrToken/products")
  async products(
    @Param("qrToken") qrToken: string,
    @Query(new ZodValidationPipe(PublicProductsQuerySchema)) query: PublicProductsQueryDto,
  ) {
    const data = await this.service.getPublicProducts(qrToken, query);
    return { data };
  }

  @Public()
  @Get(":qrToken/products/:productId")
  async productDetail(
    @Param("qrToken") qrToken: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.getPublicProductDetail(qrToken, productId);
    return { data };
  }

  @Public()
  @Get(":qrToken/session")
  async session(@Param("qrToken") qrToken: string) {
    const data = await this.service.getPublicActiveSession(qrToken);
    return { data };
  }

  @Public()
  @Post(":qrToken/orders")
  async submit(
    @Param("qrToken") qrToken: string,
    @Body(new ZodValidationPipe(SubmitTableOrderSchema)) body: SubmitTableOrderDto,
  ) {
    const data = await this.service.submitOrder(qrToken, body);
    return { data };
  }

  @Public()
  @Post(":qrToken/sessions/:sessionId/pay-online")
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
@Controller("table-orders")
@UseGuards(AccessGuard)
export class TableOrdersController {
  constructor(private readonly service: TableOrdersService) {}

  @Get()
  @RequireAccess("table-orders", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTableOrdersQuerySchema)) query: ListTableOrdersQueryDto,
  ) {
    const data = await this.service.listOrders(companyId, query);
    return { data };
  }

  @Post(":id/approve")
  @RequireAccess("table-orders", "approve")
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
  async markReady(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.markOrderReady(companyId, id);
    return { data };
  }
}

@Controller("table-sessions")
@UseGuards(AccessGuard)
export class TableSessionsController {
  constructor(private readonly service: TableOrdersService) {}

  @Get()
  @RequireAccess("table-orders", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListTableSessionsQuerySchema)) query: ListTableSessionsQueryDto,
  ) {
    const data = await this.service.listSessions(companyId, query);
    return { data };
  }

  @Post(":id/pay-cashier")
  @RequireAccess("table-orders", "pay")
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
  async forceClose(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.forceCloseSession(companyId, id);
    return { data };
  }

  @Post(":id/link-transaction")
  @RequireAccess("table-orders", "pay")
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
