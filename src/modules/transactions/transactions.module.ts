import { Module } from "@nestjs/common";
import { AutoJournalModule } from "../auto-journal/auto-journal.module";
import { DebtsModule } from "../debts/debts.module";
import { PointsModule } from "../points/points.module";
import { RacksModule } from "../racks/racks.module";
import { WhatsappReceiptModule } from "../whatsapp-receipt/whatsapp-receipt.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsRepository } from "./transactions.repository";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [
    DebtsModule,
    PointsModule,
    AutoJournalModule,
    WhatsappReceiptModule,
    RacksModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsRepository, TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
