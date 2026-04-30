import { Module } from "@nestjs/common";
import { AutoJournalModule } from "../auto-journal/auto-journal.module";
import { DebtsModule } from "../debts/debts.module";
import { PointsModule } from "../points/points.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [DebtsModule, PointsModule, AutoJournalModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
