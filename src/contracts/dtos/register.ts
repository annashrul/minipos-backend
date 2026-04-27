import { z } from "zod";

// =====================
// Company self-registration
// =====================

export const RegisterCompanySchema = z.object({
  companyName: z.string().min(1, "Nama perusahaan wajib diisi"),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  name: z.string().min(1, "Nama lengkap wajib diisi"),
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
});
export type RegisterCompanyDto = z.infer<typeof RegisterCompanySchema>;

export type RegisterCompanyResponse =
  | { status: "created" }
  | { status: "needs_verification"; email: string };

// =====================
// OTP verification
// =====================

export const VerifyEmailOtpSchema = z.object({
  email: z.string().min(1),
  otp: z.string().min(1),
});
export type VerifyEmailOtpDto = z.infer<typeof VerifyEmailOtpSchema>;

export type VerifyEmailOtpResponse = {
  loginToken: string;
};

// =====================
// Resend verification email
// =====================

export const ResendVerificationEmailSchema = z.object({
  email: z.string().min(1),
});
export type ResendVerificationEmailDto = z.infer<
  typeof ResendVerificationEmailSchema
>;

export type ResendVerificationEmailResponse = {
  success: true;
};
