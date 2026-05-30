import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  AiChatRequestSchema,
  type AiChatRequestDto,
  AiLogsQuerySchema,
  type AiLogsQueryDto,
} from "./dto/ai-assistant.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { AiAssistantService } from "./ai-assistant.service";

@ApiTags("AI Assistant")
@ApiBearerAuth()
@Controller("ai-assistant")
@UseGuards(AccessGuard)
export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  @Post("query")
  @RequireAccess("ai-assistant", "view")
  @ApiOperation({ summary: "Ask AI assistant" })
  @ApiZodBody(AiChatRequestSchema)
  async query(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AiChatRequestSchema))
    body: AiChatRequestDto,
  ) {
    const data = await this.service.chat(
      {
        userId: user.id,
        userName: user.id,
        role: user.role,
        companyId: user.companyId ?? null,
      },
      body.messages,
    );
    return { data };
  }

  @Get("logs")
  @RequireAccess("ai-assistant", "view")
  @ApiOperation({
    summary:
      "Audit log percakapan AI (filter: status=ANSWERED|UNANSWERED|ERROR, days, limit, offset)",
  })
  async logs(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AiLogsQuerySchema)) query: AiLogsQueryDto,
  ) {
    const data = await this.service.listLogs(
      {
        userId: user.id,
        userName: user.id,
        role: user.role,
        companyId: user.companyId ?? null,
      },
      query,
    );
    return { data };
  }
}
