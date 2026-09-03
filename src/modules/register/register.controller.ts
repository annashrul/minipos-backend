import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  ForgotPasswordSchema,
  RegisterCompanySchema,
  RequestRegisterOtpSchema,
  ResendPhoneOtpSchema,
  ResetPasswordSchema,
  VerifyAndCreateSchema,
  VerifyPhoneOtpSchema,
  type ForgotPasswordDto,
  type RegisterCompanyDto,
  type RequestRegisterOtpDto,
  type ResendPhoneOtpDto,
  type ResetPasswordDto,
  type VerifyAndCreateDto,
  type VerifyPhoneOtpDto,
} from "./dto/register.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { Public } from "@/modules/auth/public.decorator";
import { RegisterService } from "./register.service";

@ApiTags("Register")
@ApiBearerAuth()
@Controller("register")
export class RegisterController {
  constructor(private readonly register: RegisterService) {}

  @Public()
  @Post("company")
  @ApiOperation({ summary: "Register company" })
  @ApiZodBody(RegisterCompanySchema)
  async registerCompany(
    @Body(new ZodValidationPipe(RegisterCompanySchema))
    body: RegisterCompanyDto,
  ) {
    const data = await this.register.registerCompany(body);
    return { data };
  }

  @Public()
  @Post("verify-phone")
  @ApiOperation({ summary: "Verify phone OTP" })
  @ApiZodBody(VerifyPhoneOtpSchema)
  async verifyPhoneOtp(
    @Body(new ZodValidationPipe(VerifyPhoneOtpSchema))
    body: VerifyPhoneOtpDto,
  ) {
    const data = await this.register.verifyPhoneOtp(body);
    return { data };
  }

  @Public()
  @Post("resend-otp")
  @ApiOperation({ summary: "Resend phone OTP" })
  @ApiZodBody(ResendPhoneOtpSchema)
  async resendPhoneOtp(
    @Body(new ZodValidationPipe(ResendPhoneOtpSchema))
    body: ResendPhoneOtpDto,
  ) {
    const data = await this.register.resendPhoneOtp(body.phone, body.channel);
    return { data };
  }

  /** Helper untuk login page: lookup phone by email, lalu kirim OTP. */
  @Public()
  @Post("resend-otp-by-email")
  @ApiOperation({ summary: "Resend OTP by email lookup" })
  async resendOtpByEmail(
    @Body() body: { email?: string; channel?: "wa" | "email" },
  ) {
    const data = await this.register.resendOtpByEmail(
      body?.email ?? "",
      body?.channel ?? "wa",
    );
    return { data };
  }

  // ── New flow: request OTP → verify → create akun ──

  @Public()
  @Post("request-otp")
  @ApiOperation({ summary: "Request OTP for registration (step 1)" })
  @ApiZodBody(RequestRegisterOtpSchema)
  async requestRegisterOtp(
    @Body(new ZodValidationPipe(RequestRegisterOtpSchema))
    body: RequestRegisterOtpDto,
  ) {
    const data = await this.register.requestRegisterOtp(body);
    return { data };
  }

  @Public()
  @Post("verify-and-create")
  @ApiOperation({ summary: "Verify OTP and create company+user (step 2)" })
  @ApiZodBody(VerifyAndCreateSchema)
  async verifyAndCreate(
    @Body(new ZodValidationPipe(VerifyAndCreateSchema))
    body: VerifyAndCreateDto,
  ) {
    const data = await this.register.verifyAndCreate(body);
    return { data };
  }

  @Public()
  @Get("check")
  @ApiOperation({ summary: "Check email/phone availability" })
  async check(
    @Query("email") email?: string,
    @Query("phone") phone?: string,
  ) {
    const data = await this.register.checkAvailability(email, phone);
    return { data };
  }

  @Public()
  @Post("forgot-password")
  @ApiOperation({ summary: "Forgot password (request reset email)" })
  @ApiZodBody(ForgotPasswordSchema)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema))
    body: ForgotPasswordDto,
  ) {
    const data = await this.register.forgotPassword(body.email, body.phone, body.channel);
    return { data };
  }

  @Public()
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password" })
  @ApiZodBody(ResetPasswordSchema)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema))
    body: ResetPasswordDto,
  ) {
    const data = await this.register.resetPassword(body);
    return { data };
  }
}
