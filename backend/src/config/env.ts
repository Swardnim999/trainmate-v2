import { z } from 'zod';

/**
 * Zod-validated environment configuration.
 *
 * JWT_SECRET became required when the auth service layer landed (Sprint 2B M3):
 * the app now signs/verifies access tokens at import time, so failing fast on a
 * missing or short secret is honest, not cosmetic. Generate one with:
 *   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
 *
 * DATABASE_URL is intentionally optional at runtime: Sprint 1 opens no DB
 * connection. Prisma's schema still references env("DATABASE_URL") at
 * generate/migrate time, and it becomes required from Phase 2 onward.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Trusted reverse-proxy hops in front of this instance. 0 (default) means
  // clients connect directly and X-Forwarded-For is ignored (spoof-safe). Set to
  // the real hop count when deployed behind an LB so per-IP rate limiting keys
  // on the actual client (§16.3 Phase-14 check). Never exceed the true count.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  // Auth (Sprint 2B M3). HS256 key — see module doc for the generation command.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Comma-separated origins that email-confirmation redirect_to may point at.
  // Empty falls back to CORS_ORIGIN (Auth-Design §6.4, D-A6).
  AUTH_ALLOWED_REDIRECT_ORIGINS: z.string().default(''),
  // Public origin of THIS api, used to build email confirmation links.
  API_PUBLIC_ORIGIN: z.string().default('http://localhost:3000'),
  // Transactional Email (M14). 'console' for dev/test, 'resend' for production.
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('TrainMate <noreply@trainmate.in>'),
  // Direct database URL for Prisma migrations during pre-deployment gates.
  DIRECT_URL: z.string().optional(),
  // Redis URL for multi-instance Socket.IO adapter and distributed rate limiting.
  REDIS_URL: z.string().optional(),
  // S3 / Object storage configuration (AWS S3 ap-south-1 target).
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET_AVATARS: z.string().default('trainmate-prod-avatars'),
  S3_BUCKET_ATTACHMENTS: z.string().default('trainmate-prod-chat-attachments'),
  // Require a postgres/postgresql scheme. Deliberately NOT z.string().url():
  // the WHATWG URL parser rejects valid libpq forms (e.g. multi-host
  // `postgresql://h1:5432,h2:5432/db`) and happily accepts http:// or mysql://.
  DATABASE_URL: z
    .string()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: 'DATABASE_URL must be a postgresql:// URL',
    })
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate a raw env source (defaults to process.env) and return the typed,
 * fully-defaulted config. Throws a descriptive error listing every bad var,
 * so a misconfigured environment fails fast at startup.
 */
export function loadEnv(source: Record<string, unknown> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Singleton config, evaluated once at import time. */
export const env = loadEnv();
