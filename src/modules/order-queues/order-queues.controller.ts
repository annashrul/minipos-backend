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
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { OrderQueuesService } from "./order-queues.service";

@Controller("order-queues")
@UseGuards(AccessGuard)
export class OrderQueuesController {
  constructor(private readonly orderQueues: OrderQueuesService) {}

  @Get()
  @RequireAccess("kitchen", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.orderQueues.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("kitchen", "create")
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
