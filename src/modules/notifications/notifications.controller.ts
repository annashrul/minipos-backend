import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { NotificationsService } from "./notifications.service";

@ApiTags("Notifications")
@ApiBearerAuth()
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("low-stock")
  @ApiOperation({ summary: "List low stock products" })
  async lowStock(@CurrentCompany() companyId: string) {
    const data = await this.notifications.getLowStockProducts(companyId);
    return { data };
  }

  @Get("expiring")
  @ApiOperation({ summary: "List expiring products" })
  async expiring(@CurrentCompany() companyId: string) {
    const data = await this.notifications.getExpiringProducts(companyId);
    return { data };
  }
}
