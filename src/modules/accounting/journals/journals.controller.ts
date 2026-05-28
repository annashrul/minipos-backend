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
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateJournalSchema,
  ListJournalsQuerySchema,
  UpdateJournalSchema,
  VoidJournalSchema,
  type CreateJournalDto,
  type ListJournalsQueryDto,
  type UpdateJournalDto,
  type VoidJournalDto,
} from "../dto/accounting.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { JournalsService } from "./journals.service";

@ApiTags("Journals")
@ApiBearerAuth()
@Controller("journals")
@UseGuards(AccessGuard)
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @Get()
  @RequireAccess("journals", "view")
  @ApiOperation({ summary: "List journals" })
  @ApiZodQuery(ListJournalsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListJournalsQuerySchema))
    query: ListJournalsQueryDto,
  ) {
    const data = await this.journals.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("journals", "view")
  @ApiOperation({ summary: "Get journal by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("journals", "create")
  @ApiOperation({ summary: "Create journal entry" })
  @ApiZodBody(CreateJournalSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateJournalSchema)) body: CreateJournalDto,
  ) {
    const data = await this.journals.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("journals", "update")
  @ApiOperation({ summary: "Update journal entry" })
  @ApiZodBody(UpdateJournalSchema)
  async update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateJournalSchema)) body: UpdateJournalDto,
  ) {
    const data = await this.journals.update(companyId, user.id, id, body);
    return { data };
  }

  @Post(":id/post")
  @RequireAccess("journals", "post")
  @ApiOperation({ summary: "Post journal entry" })
  async post(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.journals.post(companyId, user.id, id);
    return { data };
  }

  @Post(":id/submit-approval")
  @RequireAccess("journals", "create")
  @ApiOperation({ summary: "Submit journal entry for approval" })
  async submitApproval(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.journals.submitForApproval(companyId, user.id, id);
    return { data };
  }

  @Post(":id/approve")
  @RequireAccess("journals", "approve")
  @ApiOperation({ summary: "Approve journal entry" })
  async approveEntry(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.journals.approve(companyId, user.id, id);
    return { data };
  }

  @Post(":id/reject")
  @RequireAccess("journals", "approve")
  @ApiOperation({ summary: "Reject journal entry" })
  async rejectEntry(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { reason: string },
  ) {
    const data = await this.journals.reject(
      companyId,
      user.id,
      id,
      body?.reason ?? "",
    );
    return { data };
  }

  @Get(":id/change-history")
  @RequireAccess("journals", "view")
  @ApiOperation({ summary: "Get journal change history" })
  async changeHistory(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.changeHistory(companyId, id);
    return { data };
  }

  @Post(":id/void")
  @RequireAccess("journals", "void")
  @ApiOperation({ summary: "Void journal entry" })
  @ApiZodBody(VoidJournalSchema)
  async voidEntry(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(VoidJournalSchema)) body: VoidJournalDto,
  ) {
    const data = await this.journals.voidEntry(companyId, user.id, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("journals", "delete")
  @ApiOperation({ summary: "Delete journal entry" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.delete(companyId, id);
    return { data };
  }
}
