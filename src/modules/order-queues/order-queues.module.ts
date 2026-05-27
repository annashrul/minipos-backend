import { Module } from "@nestjs/common";
import { OrderQueuesController } from "./order-queues.controller";
import { OrderQueuesRepository } from "./order-queues.repository";
import { OrderQueuesService } from "./order-queues.service";

@Module({
  controllers: [OrderQueuesController],
  providers: [OrderQueuesRepository, OrderQueuesService],
  exports: [OrderQueuesService],
})
export class OrderQueuesModule {}
