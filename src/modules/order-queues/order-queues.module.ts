import { Module } from "@nestjs/common";
import { OrderQueuesController } from "./order-queues.controller";
import { OrderQueuesService } from "./order-queues.service";

@Module({
  controllers: [OrderQueuesController],
  providers: [OrderQueuesService],
  exports: [OrderQueuesService],
})
export class OrderQueuesModule {}
