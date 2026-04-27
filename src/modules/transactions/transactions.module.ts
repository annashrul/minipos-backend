import { Module } from "@nestjs/common";
import { DebtsModule } from "../debts/debts.module";
import { PointsModule } from "../points/points.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [DebtsModule, PointsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
