import { Injectable } from "@nestjs/common";
import type { AiChatMessageDto, AiChatResponse } from "@/contracts";
import { AiChatService } from "./internal/ai-chat.service";
import type { AuthContext } from "./internal/ai-tools.definitions";

/**
 * Facade tipis. Delegasi:
 *  - AiChatService     → Groq API call + tool-call loop
 *  - AiToolExecutor    → eksekusi tool (Prisma queries, panggilan ke service lain)
 *  - tools.definitions → konstanta TOOLS + AuthContext type
 */
@Injectable()
export class AiAssistantService {
  constructor(private readonly chatService: AiChatService) {}

  chat(auth: AuthContext, messages: AiChatMessageDto[]): Promise<AiChatResponse> {
    return this.chatService.chat(auth, messages);
  }
}
