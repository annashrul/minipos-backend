import { Controller, Get } from "@nestjs/common";
import { CurrentCompany } from "../auth/current-company.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("low-stock")
  async lowStock(@CurrentCompany() companyId: string) {
    const data = await this.notifications.getLowStockProducts(companyId);
    return { data };
  }

  @Get("expiring")
  async expiring(@CurrentCompany() companyId: string) {
    const data = await this.notifications.getExpiringProducts(companyId);
    return { data };
  }
}
