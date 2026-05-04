import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";
import { AccessGuard } from "./access.guard";

const devTokenSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  companyId: z.string().nullable().default(null),
  branchId: z.string().nullable().default(null),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const loginWithTokenSchema = z.object({
  token: z.string().min(1),
});

const checkAccessSchema = z.object({
  menu: z.string().min(1),
  action: z.string().min(1).default("view"),
});

@Controller("auth")
@UseGuards(AccessGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    const result = await this.auth.login(body.email, body.password);
    return { data: result };
  }

  @Public()
  @Post("login-with-token")
  async loginWithToken(
    @Body(new ZodValidationPipe(loginWithTokenSchema))
    body: z.infer<typeof loginWithTokenSchema>,
  ) {
    const result = await this.auth.loginWithToken(body.token);
    return { data: result };
  }

  @Get("check-access")
  async checkAccess(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(checkAccessSchema)) q: z.infer<typeof checkAccessSchema>,
  ) {
    const allowed = await this.auth.checkAccess(user.role, q.menu, q.action);
    return { data: { allowed } };
  }

  @Public()
  @Post("dev-token")
  devToken(
    @Body(new ZodValidationPipe(devTokenSchema)) body: z.infer<typeof devTokenSchema>,
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("dev-token is disabled in production");
    }
    const token = this.auth.signToken({
      id: body.userId,
      role: body.role,
      companyId: body.companyId,
      branchId: body.branchId,
    });
    return { data: { token } };
  }
}
