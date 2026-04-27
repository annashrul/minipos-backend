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
  CreateRecurringJournalSchema,
  ListRecurringJournalsQuerySchema,
  RunRecurringJournalSchema,
  ToggleRecurringJournalSchema,
  UpdateRecurringJournalSchema,
  type AuthUser,
  type CreateRecurringJournalDto,
  type ListRecurringJournalsQueryDto,
  type RunRecurringJournalDto,
  type ToggleRecurringJournalDto,
  type UpdateRecurringJournalDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { RecurringJournalsService } from "./recurring-journals.service";

@Controller("recurring-journals")
@UseGuards(AccessGuard)
export class RecurringJournalsController {
  constructor(private readonly service: RecurringJournalsService) {}

  @Get()
  @RequireAccess("accounting-recurring", "view")
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
  async listDue(@CurrentCompany() companyId: string) {
    const data = await this.service.listDue(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting-recurring", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting-recurring", "create")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.delete(companyId, id);
    return { data };
  }
}
