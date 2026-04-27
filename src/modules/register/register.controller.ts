import { Body, Controller, Post } from "@nestjs/common";
import {
  RegisterCompanySchema,
  ResendVerificationEmailSchema,
  VerifyEmailOtpSchema,
  type RegisterCompanyDto,
  type ResendVerificationEmailDto,
  type VerifyEmailOtpDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { Public } from "../auth/public.decorator";
import { RegisterService } from "./register.service";

@Controller("register")
export class RegisterController {
  constructor(private readonly register: RegisterService) {}

  @Public()
  @Post("company")
  async registerCompany(
    @Body(new ZodValidationPipe(RegisterCompanySchema))
    body: RegisterCompanyDto,
  ) {
    const data = await this.register.registerCompany(body);
    return { data };
  }

  @Public()
  @Post("verify-email")
  async verifyEmailOtp(
    @Body(new ZodValidationPipe(VerifyEmailOtpSchema))
    body: VerifyEmailOtpDto,
  ) {
    const data = await this.register.verifyEmailOtp(body);
    return { data };
  }

  @Public()
  @Post("resend-verification")
  async resendVerificationEmail(
    @Body(new ZodValidationPipe(ResendVerificationEmailSchema))
    body: ResendVerificationEmailDto,
  ) {
    const data = await this.register.resendVerificationEmail(body.email);
    return { data };
  }
}
