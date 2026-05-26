import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  WhatsappBotConfigUpdateSchema,
  WhatsappBotTestSchema,
  type WhatsappBotConfigUpdateDto,
  type WhatsappBotTestDto,
} from "./dto/whatsapp-bot.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { WhatsappChatbotService } from "./whatsapp-chatbot.service";

@Controller("whatsapp-bot")
@UseGuards(AccessGuard)
export class WhatsappChatbotController {
  constructor(private readonly service: WhatsappChatbotService) {}

  @Get("config")
  @RequireAccess("whatsapp-bot", "view")
  async getConfig(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    return { data: await this.service.getConfig(user.companyId) };
  }

  @Patch("config")
  @RequireAccess("whatsapp-bot", "update")
  async updateConfig(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(WhatsappBotConfigUpdateSchema))
    body: WhatsappBotConfigUpdateDto,
  ) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    return { data: await this.service.updateConfig(user.companyId, body) };
  }

  @Post("test")
  @RequireAccess("whatsapp-bot", "view")
  async test(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(WhatsappBotTestSchema))
    body: WhatsappBotTestDto,
  ) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    const r = await this.service.testReply(
      user.companyId,
      body.message,
      body.asOwner,
    );
    return { data: r };
  }

  @Post("reset-knowledge")
  @RequireAccess("whatsapp-bot", "update")
  async resetKnowledge(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    return { data: await this.service.resetKnowledgeToDefault(user.companyId) };
  }
}
