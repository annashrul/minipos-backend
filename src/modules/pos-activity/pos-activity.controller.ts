import { Body, Controller, Post } from "@nestjs/common";
import {
  LogPosActivitySchema,
  type AuthUser,
  type LogPosActivityDto,
} from "@/contracts";
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
