import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { type AuthUser } from "@/contracts";
import {
  LogPosActivitySchema,
  type LogPosActivityDto,
} from "./dto/pos-activity.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { PosActivityService } from "./pos-activity.service";

@ApiTags("POS Activity")
@ApiBearerAuth()
@Controller("pos-activity")
export class PosActivityController {
  constructor(private readonly posActivity: PosActivityService) {}

  @Post()
  @ApiOperation({ summary: "Log POS activity" })
  @ApiZodBody(LogPosActivitySchema)
  async log(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LogPosActivitySchema))
    body: LogPosActivityDto,
  ) {
    const data = await this.posActivity.log(user.id, body);
    return { data };
  }
}
