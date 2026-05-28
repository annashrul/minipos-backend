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
  CreateOrderQueueFromTransactionSchema,
  CreateOrderQueueSchema,
  ListOrderQueuesQuerySchema,
  UpdateOrderQueueItemStatusSchema,
  UpdateOrderQueueStatusSchema,
  type CreateOrderQueueDto,
  type CreateOrderQueueFromTransactionDto,
  type ListOrderQueuesQueryDto,
  type UpdateOrderQueueItemStatusDto,
  type UpdateOrderQueueStatusDto,
} from "./dto/order-queues.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { OrderQueuesService } from "./order-queues.service";

@ApiTags("Order Queues")
@ApiBearerAuth()
@Controller("order-queues")
@UseGuards(AccessGuard)
export class OrderQueuesController {
  constructor(private readonly orderQueues: OrderQueuesService) {}

  @Get()
  @RequireAccess("kitchen", "view")
  @ApiOperation({ summary: "List order queues" })
  @ApiZodQuery(ListOrderQueuesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListOrderQueuesQuerySchema))
    query: ListOrderQueuesQueryDto,
  ) {
    const data = await this.orderQueues.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("kitchen", "view")
  @ApiOperation({ summary: "Get order queue by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.orderQueues.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("kitchen", "create")
  @ApiOperation({ summary: "Create order queue" })
  @ApiZodBody(CreateOrderQueueSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateOrderQueueSchema))
    body: CreateOrderQueueDto,
  ) {
    const data = await this.orderQueues.create(companyId, body);
    return { data };
  }

  @Post("from-transaction")
  @RequireAccess("kitchen", "create")
  @ApiOperation({ summary: "Create order queue from transaction" })
  @ApiZodBody(CreateOrderQueueFromTransactionSchema)
  async createFromTransaction(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateOrderQueueFromTransactionSchema))
    body: CreateOrderQueueFromTransactionDto,
  ) {
    const data = await this.orderQueues.createFromTransaction(companyId, body);
    return { data };
  }

  @Patch(":id/status")
  @RequireAccess("kitchen", "update")
  @ApiOperation({ summary: "Update order queue status" })
  @ApiZodBody(UpdateOrderQueueStatusSchema)
  async updateStatus(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateOrderQueueStatusSchema))
    body: UpdateOrderQueueStatusDto,
  ) {
    const data = await this.orderQueues.updateStatus(companyId, id, body.status);
    return { data };
  }

  @Patch(":id/items/:itemId/status")
  @RequireAccess("kitchen", "update")
  @ApiOperation({ summary: "Update order queue item status" })
  @ApiZodBody(UpdateOrderQueueItemStatusSchema)
  async updateItemStatus(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(UpdateOrderQueueItemStatusSchema))
    body: UpdateOrderQueueItemStatusDto,
  ) {
    const data = await this.orderQueues.updateItemStatus(
      companyId,
      id,
      itemId,
      body.status,
    );
    return { data };
  }
}
