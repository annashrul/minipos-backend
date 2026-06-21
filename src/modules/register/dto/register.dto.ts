import { z } from "zod";

export const BUSINESS_UNITS = ["RETAIL", "BENGKEL", "RESTAURANT", "CAFE", "APOTEK"] as const;
export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

/** Kanal pengiriman OTP: WhatsApp (default) atau Email. */
export const OTP_CHANNELS = ["wa", "email"] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];
export const OtpChannelSchema = z.enum(OTP_CHANNELS).default("wa");

export const RegisterCompanySchema = z.object({
  companyName: z.string().min(1, "Nama perusahaan wajib diisi"),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  businessUnit: z.enum(BUSINESS_UNITS).default("RETAIL"),
  name: z.string().min(1, "Nama lengkap wajib diisi"),
  email: z.string().email("Format email tidak valid"),
  phone: z.string().min(8, "Nomor WhatsApp wajib diisi"),
  password: z.string().min(6, "Password minimal 6 karakter"),
  channel: OtpChannelSchema.optional(),
});
export type RegisterCompanyDto = z.infer<typeof RegisterCompanySchema>;

export type RegisterCompanyResponse =
  | { status: "created" }
  | {
      status: "needs_verification";
      phone: string;
      channel: OtpChannel;
      destinationMasked: string;
    };

export const VerifyPhoneOtpSchema = z.object({
  phone: z.string().min(1),
  otp: z.string().min(1),
});
export type VerifyPhoneOtpDto = z.infer<typeof VerifyPhoneOtpSchema>;

export type VerifyPhoneOtpResponse = {
  loginToken: string;
};

export const ResendPhoneOtpSchema = z.object({
  phone: z.string().min(1),
  channel: OtpChannelSchema.optional(),
});
export type ResendPhoneOtpDto = z.infer<typeof ResendPhoneOtpSchema>;

export type ResendPhoneOtpResponse = {
  success: true;
};

export const ForgotPasswordSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  channel: OtpChannelSchema.optional(),
});
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;

export type ForgotPasswordResponse = {
  phoneMasked: string;
  phone: string;
  channel: OtpChannel;
  /** Tujuan yang disamarkan sesuai channel (no HP atau email). */
  destinationMasked: string;
};

export const ResetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(4),
  newPassword: z.string().min(6, "Password minimal 6 karakter"),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

export type ResetPasswordResponse = {
  success: true;
};
