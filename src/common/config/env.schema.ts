import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine(
    (v) => v === undefined || /^(https?|redis|rediss):\/\//.test(v),
    { message: "Harus URL valid (http/https/redis)" },
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib"),
  DIRECT_URL: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET minimal 32 karakter — generate via `openssl rand -base64 32`"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  REDIS_URL: optionalUrl,

  CORS_ORIGINS: z.string().optional(),
  WEB_ORIGIN: z.string().optional(),

  CLOUDINARY_URL: z.string().optional(),

  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  BODY_LIMIT: z.string().default("2mb"),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return parsed.data;
}
