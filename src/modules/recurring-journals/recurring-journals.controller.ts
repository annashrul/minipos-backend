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
  CreateRecurringJournalSchema,
  ListRecurringJournalsQuerySchema,
  RunRecurringJournalSchema,
  ToggleRecurringJournalSchema,
  UpdateRecurringJournalSchema,
  type CreateRecurringJournalDto,
  type ListRecurringJournalsQueryDto,
  type RunRecurringJournalDto,
  type ToggleRecurringJournalDto,
  type UpdateRecurringJournalDto,
} from "./dto/recurring-journals.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { RecurringJournalsService } from "./recurring-journals.service";

@ApiTags("Recurring Journals")
@ApiBearerAuth()
@Controller("recurring-journals")
@UseGuards(AccessGuard)
export class RecurringJournalsController {
  constructor(private readonly service: RecurringJournalsService) {}

  @Get()
  @RequireAccess("accounting-recurring", "view")
  @ApiOperation({ summary: "List recurring journals" })
  @ApiZodQuery(ListRecurringJournalsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListRecurringJournalsQuerySchema))
    query: ListRecurringJournalsQueryDto,
  ) {
    const data = await this.service.list(companyId, query);
    return { data };
  }

  @Get("due")
  @RequireAccess("accounting-recurring", "view")
  @ApiOperation({ summary: "List due recurring journals" })
  async listDue(@CurrentCompany() companyId: string) {
    const data = await this.service.listDue(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting-recurring", "view")
  @ApiOperation({ summary: "Get recurring journal by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting-recurring", "create")
  @ApiOperation({ summary: "Create recurring journal" })
  @ApiZodBody(CreateRecurringJournalSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateRecurringJournalSchema))
    body: CreateRecurringJournalDto,
  ) {
    const data = await this.service.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("accounting-recurring", "update")
  @ApiOperation({ summary: "Update recurring journal" })
  @ApiZodBody(UpdateRecurringJournalSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateRecurringJournalSchema))
    body: UpdateRecurringJournalDto,
  ) {
    const data = await this.service.update(companyId, id, body);
    return { data };
  }

  @Post(":id/run")
  @RequireAccess("accounting-recurring", "run")
  @ApiOperation({ summary: "Run recurring journal" })
  @ApiZodBody(RunRecurringJournalSchema)
  async run(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RunRecurringJournalSchema))
    body: RunRecurringJournalDto,
  ) {
    const data = await this.service.run(companyId, user.id, id, body);
    return { data };
  }

  @Patch(":id/toggle")
  @RequireAccess("accounting-recurring", "update")
  @ApiOperation({ summary: "Toggle recurring journal active state" })
  @ApiZodBody(ToggleRecurringJournalSchema)
  async toggle(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ToggleRecurringJournalSchema))
    body: ToggleRecurringJournalDto,
  ) {
    const data = await this.service.toggle(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("accounting-recurring", "delete")
  @ApiOperation({ summary: "Delete recurring journal" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.delete(companyId, id);
    return { data };
  }
}
