import { Module } from "@nestjs/common";
import { AccountCategoriesModule } from "./account-categories/account-categories.module";
import { AccountsModule } from "./accounts/accounts.module";
import { JournalsModule } from "./journals/journals.module";

@Module({
  imports: [AccountCategoriesModule, AccountsModule, JournalsModule],
  exports: [AccountCategoriesModule, AccountsModule, JournalsModule],
})
export class AccountingModule {}
