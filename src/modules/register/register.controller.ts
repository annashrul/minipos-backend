import { Body, Controller, Post } from "@nestjs/common";
import {
  ForgotPasswordSchema,
  RegisterCompanySchema,
  ResendPhoneOtpSchema,
  ResetPasswordSchema,
  VerifyPhoneOtpSchema,
  type ForgotPasswordDto,
  type RegisterCompanyDto,
  type ResendPhoneOtpDto,
  type ResetPasswordDto,
  type VerifyPhoneOtpDto,
} from "./dto/register.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { Public } from "@/modules/auth/public.decorator";
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
  @Post("verify-phone")
  async verifyPhoneOtp(
    @Body(new ZodValidationPipe(VerifyPhoneOtpSchema))
    body: VerifyPhoneOtpDto,
  ) {
    const data = await this.register.verifyPhoneOtp(body);
    return { data };
  }

  @Public()
  @Post("resend-otp")
  async resendPhoneOtp(
    @Body(new ZodValidationPipe(ResendPhoneOtpSchema))
    body: ResendPhoneOtpDto,
  ) {
    const data = await this.register.resendPhoneOtp(body.phone);
    return { data };
  }

  /** Helper untuk login page: lookup phone by email, lalu kirim OTP. */
  @Public()
  @Post("resend-otp-by-email")
  async resendOtpByEmail(@Body() body: { email?: string }) {
    const data = await this.register.resendOtpByEmail(body?.email ?? "");
    return { data };
  }

  @Public()
  @Post("forgot-password")
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema))
    body: ForgotPasswordDto,
  ) {
    const data = await this.register.forgotPassword(body.email);
    return { data };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema))
    body: ResetPasswordDto,
  ) {
    const data = await this.register.resetPassword(body);
    return { data };
  }
}
