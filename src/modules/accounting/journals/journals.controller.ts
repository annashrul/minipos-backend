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
  CreateJournalSchema,
  ListJournalsQuerySchema,
  UpdateJournalSchema,
  VoidJournalSchema,
  type AuthUser,
  type CreateJournalDto,
  type ListJournalsQueryDto,
  type UpdateJournalDto,
  type VoidJournalDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../../common/pipes/zod.pipe";
import { AccessGuard } from "../../auth/access.guard";
import { CurrentCompany } from "../../auth/current-company.decorator";
import { CurrentUser } from "../../auth/current-user.decorator";
import { RequireAccess } from "../../auth/require-access.decorator";
import { JournalsService } from "./journals.service";

@Controller("journals")
@UseGuards(AccessGuard)
export class JournalsController {
  constructor(private readonly journals: JournalsService) {}

  @Get()
  @RequireAccess("journals", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("journals", "create")
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
  async changeHistory(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.changeHistory(companyId, id);
    return { data };
  }

  @Post(":id/void")
  @RequireAccess("journals", "void")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.journals.delete(companyId, id);
    return { data };
  }
}
