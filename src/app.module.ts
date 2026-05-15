import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard";
import { HealthModule } from "./modules/health/health.module";
import { AccountingModule } from "./modules/accounting/accounting.module";
import { AiAssistantModule } from "./modules/ai-assistant/ai-assistant.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AccountingPeriodsModule } from "./modules/accounting-periods/accounting-periods.module";
import { AccountingReportsModule } from "./modules/accounting-reports/accounting-reports.module";
import { AuditLogsModule } from "./modules/audit-logs/audit-logs.module";
import { BankReconciliationModule } from "./modules/bank-reconciliation/bank-reconciliation.module";
import { BranchesModule } from "./modules/branches/branches.module";
import { BrandsModule } from "./modules/brands/brands.module";
import { BundlesModule } from "./modules/bundles/bundles.module";
import { RecipesModule } from "./modules/recipes/recipes.module";
import { CashierModule } from "./modules/cashier/cashier.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { ClosingReportsModule } from "./modules/closing-reports/closing-reports.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DebtsModule } from "./modules/debts/debts.module";
import { EmployeeSchedulesModule } from "./modules/employee-schedules/employee-schedules.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { GiftCardsModule } from "./modules/gift-cards/gift-cards.module";
import { GoodsReceiptsModule } from "./modules/goods-receipts/goods-receipts.module";
import { InstallmentsModule } from "./modules/installments/installments.module";
import { InventoryForecastModule } from "./modules/inventory-forecast/inventory-forecast.module";
import { MeModule } from "./modules/me/me.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { OrderQueuesModule } from "./modules/order-queues/order-queues.module";
import { PlansModule } from "./modules/plans/plans.module";
import { PlatformDashboardModule } from "./modules/platform-dashboard/platform-dashboard.module";
import { PlatformNotificationsModule } from "./modules/platform-notifications/platform-notifications.module";
import { PlatformSubscriptionsModule } from "./modules/platform-subscriptions/platform-subscriptions.module";
import { PointsModule } from "./modules/points/points.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PosActivityModule } from "./modules/pos-activity/pos-activity.module";
import { ProductExtensionsModule } from "./modules/product-extensions/product-extensions.module";
import { ProductsModule } from "./modules/products/products.module";
import { ProfitDashboardModule } from "./modules/profit-dashboard/profit-dashboard.module";
import { PromotionsModule } from "./modules/promotions/promotions.module";
import { PurchasesModule } from "./modules/purchases/purchases.module";
import { RecurringJournalsModule } from "./modules/recurring-journals/recurring-journals.module";
import { RegisterModule } from "./modules/register/register.module";
import { AutoJournalModule } from "./modules/auto-journal/auto-journal.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { ReturnsModule } from "./modules/returns/returns.module";
import { RolesModule } from "./modules/roles/roles.module";
import { SalesTargetsModule } from "./modules/sales-targets/sales-targets.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { VouchersModule } from "./modules/vouchers/vouchers.module";
import { ShiftsModule } from "./modules/shifts/shifts.module";
import { StockModule } from "./modules/stock/stock.module";
import { StockOpnameModule } from "./modules/stock-opname/stock-opname.module";
import { StockTransfersModule } from "./modules/stock-transfers/stock-transfers.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { TablesModule } from "./modules/tables/tables.module";
import { TableOrdersModule } from "./modules/table-orders/table-orders.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";
import { ModifiersModule } from "./modules/modifiers/modifiers.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersModule } from "./modules/users/users.module";
import { ServiceOrdersModule } from "./modules/service-orders/service-orders.module";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { PublicBookingsModule } from "./modules/public-bookings/public-bookings.module";
import { VehiclesModule } from "./modules/vehicles/vehicles.module";
import { WhatsappReceiptModule } from "./modules/whatsapp-receipt/whatsapp-receipt.module";
import { WhatsappChatbotModule } from "./modules/whatsapp-chatbot/whatsapp-chatbot.module";
import { MarketplaceShopeeModule } from "./modules/marketplace-shopee/marketplace-shopee.module";
import { MarketplaceGrabModule } from "./modules/marketplace-grab/marketplace-grab.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    RealtimeModule,
    AuthModule,
    HealthModule,
    MeModule,
    AccountingModule,
    AiAssistantModule,
    AnalyticsModule,
    AccountingPeriodsModule,
    AccountingReportsModule,
    AuditLogsModule,
    BankReconciliationModule,
    BranchesModule,
    BrandsModule,
    BundlesModule,
    RecipesModule,
    CashierModule,
    CategoriesModule,
    ClosingReportsModule,
    CustomersModule,
    DashboardModule,
    DebtsModule,
    EmployeeSchedulesModule,
    ExpensesModule,
    GiftCardsModule,
    GoodsReceiptsModule,
    InstallmentsModule,
    InventoryForecastModule,
    NotificationsModule,
    OrderQueuesModule,
    PlansModule,
    PlatformDashboardModule,
    PlatformNotificationsModule,
    PlatformSubscriptionsModule,
    PointsModule,
    PaymentsModule,
    PosActivityModule,
    ProductExtensionsModule,
    ProductsModule,
    ProfitDashboardModule,
    PromotionsModule,
    PurchasesModule,
    RecurringJournalsModule,
    RegisterModule,
    AutoJournalModule,
    ReportsModule,
    ReturnsModule,
    RolesModule,
    SalesTargetsModule,
    SettingsModule,
    ShiftsModule,
    StockModule,
    StockOpnameModule,
    StockTransfersModule,
    SubscriptionsModule,
    SuppliersModule,
    TablesModule,
    TableOrdersModule,
    ModifiersModule,
    TransactionsModule,
    UploadsModule,
    UsersModule,
    VehiclesModule,
    ServiceOrdersModule,
    BookingsModule,
    PublicBookingsModule,
    VouchersModule,
    WhatsappReceiptModule,
    WhatsappChatbotModule,
    MarketplaceShopeeModule,
    MarketplaceGrabModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
