import { Module } from "@nestjs/common";
import { DebtsModule } from "../debts/debts.module";
import { PointsModule } from "../points/points.module";
import { CheckoutService } from "./internal/checkout.service";
import { InvoiceNumberGenerator } from "./internal/invoice-number.generator";
import { TransactionQueryService } from "./internal/transaction-query.service";
import { TransactionStatusService } from "./internal/transaction-status.service";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [DebtsModule, PointsModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionQueryService,
    CheckoutService,
    TransactionStatusService,
    InvoiceNumberGenerator,
  ],
  exports: [TransactionsService],
})
export class TransactionsModule {}
