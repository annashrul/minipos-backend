import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateApprovalSchema,
  ListApprovalsQuerySchema,
  RejectApprovalSchema,
  ReviewApprovalSchema,
  type AuthUser,
  type CreateApprovalDto,
  type ListApprovalsQueryDto,
  type RejectApprovalDto,
  type ReviewApprovalDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ApprovalsService } from "./approvals.service";

@Controller("approvals")
@UseGuards(AccessGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequireAccess("approvals", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListApprovalsQuerySchema))
    query: ListApprovalsQueryDto,
  ) {
    const data = await this.approvals.list(companyId, query);
    return { data };
  }

  @Get("pending-count")
  @RequireAccess("approvals", "view")
  async pendingCount(@CurrentCompany() companyId: string) {
    const data = await this.approvals.pendingCount(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("approvals", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.approvals.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("approvals", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateApprovalSchema))
    body: CreateApprovalDto,
  ) {
    const data = await this.approvals.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id/approve")
  @RequireAccess("approvals", "approve")
  async approve(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReviewApprovalSchema))
    body: ReviewApprovalDto,
  ) {
    const data = await this.approvals.approve(companyId, user.id, id, body);
    return { data };
  }

  @Patch(":id/reject")
  @RequireAccess("approvals", "reject")
  async reject(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RejectApprovalSchema))
    body: RejectApprovalDto,
  ) {
    const data = await this.approvals.reject(companyId, user.id, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("approvals", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.approvals.delete(companyId, user.id, id);
    return { data };
  }
}
