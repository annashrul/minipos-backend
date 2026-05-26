import { Body, Controller, Post } from "@nestjs/common";
import { type AuthUser } from "@/contracts";
import {
  LogPosActivitySchema,
  type LogPosActivityDto,
} from "./dto/pos-activity.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { PosActivityService } from "./pos-activity.service";

@Controller("pos-activity")
export class PosActivityController {
  constructor(private readonly posActivity: PosActivityService) {}

  @Post()
  async log(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LogPosActivitySchema))
    body: LogPosActivityDto,
  ) {
    const data = await this.posActivity.log(user.id, body);
    return { data };
  }
}
