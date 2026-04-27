import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AuditSummaryQuerySchema,
  CreateActivityLogSchema,
  ListActivityLogsQuerySchema,
  ListAuditLogsQuerySchema,
  type AuditSummaryQueryDto,
  type AuthUser,
  type CreateActivityLogDto,
  type ListActivityLogsQueryDto,
  type ListAuditLogsQueryDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { AuditLogsService } from "./audit-logs.service";

@Controller()
@UseGuards(AccessGuard)
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  // ===========================
  // AuditLog
  // ===========================

  @Get("audit-logs/summary")
  @RequireAccess("audit-logs", "view")
  async auditSummary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AuditSummaryQuerySchema))
    query: AuditSummaryQueryDto,
  ) {
    const data = await this.auditLogs.summary(companyId, query);
    return { data };
  }

  @Get("audit-logs/entity/:entity/:entityId")
  @RequireAccess("audit-logs", "view")
  async auditByEntity(
    @CurrentCompany() companyId: string,
    @Param("entity") entity: string,
    @Param("entityId") entityId: string,
  ) {
    const data = await this.auditLogs.findByEntity(
      companyId,
      entity,
      entityId,
    );
    return { data };
  }

  @Get("audit-logs/:id")
  @RequireAccess("audit-logs", "view")
  async auditFindOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.auditLogs.findAuditLog(companyId, id);
    return { data };
  }

  @Get("audit-logs")
  @RequireAccess("audit-logs", "view")
  async auditList(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema))
    query: ListAuditLogsQueryDto,
  ) {
    const data = await this.auditLogs.listAuditLogs(companyId, query);
    return { data };
  }

  // ===========================
  // ActivityLog
  // ===========================

  @Get("activity-logs/:id")
  @RequireAccess("activity-logs", "view")
  async activityFindOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.auditLogs.findActivityLog(companyId, id);
    return { data };
  }

  @Get("activity-logs")
  @RequireAccess("activity-logs", "view")
  async activityList(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListActivityLogsQuerySchema))
    query: ListActivityLogsQueryDto,
  ) {
    const data = await this.auditLogs.listActivityLogs(companyId, query);
    return { data };
  }

  @Post("activity-logs")
  async activityCreate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateActivityLogSchema))
    body: CreateActivityLogDto,
  ) {
    const data = await this.auditLogs.createActivityLog(user.id, body);
    return { data };
  }
}
