import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  CreateAutoJournalSchema,
  type CreateAutoJournalDto,
} from "./dto/auto-journal.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { AutoJournalService } from "./auto-journal.service";

@Controller("auto-journal")
@UseGuards(AccessGuard)
export class AutoJournalController {
  constructor(private readonly service: AutoJournalService) {}

  @Post()
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateAutoJournalSchema))
    body: CreateAutoJournalDto,
  ) {
    const data = await this.service.create(companyId, user.id, body);
    return { data };
  }
}
