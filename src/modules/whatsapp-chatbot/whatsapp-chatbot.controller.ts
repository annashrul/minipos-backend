import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  WhatsappBotConfigUpdateSchema,
  WhatsappBotTestSchema,
  type WhatsappBotConfigUpdateDto,
  type WhatsappBotTestDto,
} from "./dto/whatsapp-bot.dto";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { WhatsappChatbotService } from "./whatsapp-chatbot.service";

@ApiTags("WhatsApp Bot")
@ApiBearerAuth()
@Controller("whatsapp-bot")
@UseGuards(AccessGuard)
export class WhatsappChatbotController {
  constructor(private readonly service: WhatsappChatbotService) {}

  @Get("config")
  @RequireAccess("whatsapp-bot", "view")
  @ApiOperation({ summary: "Get WhatsApp bot config" })
  async getConfig(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    return { data: await this.service.getConfig(user.companyId) };
  }

  @Patch("config")
  @RequireAccess("whatsapp-bot", "update")
  @ApiOperation({ summary: "Update WhatsApp bot config" })
  @ApiZodBody(WhatsappBotConfigUpdateSchema)
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
  @ApiOperation({ summary: "Test WhatsApp bot reply" })
  @ApiZodBody(WhatsappBotTestSchema)
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
  @ApiOperation({ summary: "Reset WhatsApp bot knowledge" })
  async resetKnowledge(@CurrentUser() user: AuthUser) {
    if (!user.companyId) throw new BadRequestException("Company tidak ditemukan");
    return { data: await this.service.resetKnowledgeToDefault(user.companyId) };
  }
}
