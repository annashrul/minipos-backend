import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  AiChatRequestSchema,
  type AiChatRequestDto,
  type AuthUser,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { AiAssistantService } from "./ai-assistant.service";

@Controller("ai-assistant")
@UseGuards(AccessGuard)
export class AiAssistantController {
  constructor(private readonly service: AiAssistantService) {}

  @Post("query")
  @RequireAccess("ai-assistant", "view")
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
}
