import { Module } from "@nestjs/common";
import { AutoJournalModule } from "@/modules/auto-journal/auto-journal.module";
import { DebtsModule } from "@/modules/debts/debts.module";
import { PointsModule } from "@/modules/points/points.module";
import { RacksModule } from "@/modules/racks/racks.module";
import { WhatsappReceiptModule } from "@/modules/whatsapp-receipt/whatsapp-receipt.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsRepository } from "./transactions.repository";
import { TransactionsService } from "./transactions.service";
import { TransactionCheckoutService } from "./transaction-checkout.service";
import { TransactionVoidRefundService } from "./transaction-void-refund.service";

@Module({
  imports: [
    DebtsModule,
    PointsModule,
    AutoJournalModule,
    WhatsappReceiptModule,
    RacksModule,
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsRepository,
    TransactionCheckoutService,
    TransactionVoidRefundService,
    TransactionsService,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
