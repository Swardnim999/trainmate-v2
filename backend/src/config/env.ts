import { z } from 'zod';

/**
 * Zod-validated environment configuration (Sprint 1 foundation set).
 *
 * Only variables the Sprint 1 app actually consumes are validated here.
 * Future-phase variables (JWT_SECRET, S3_*, ...) live in `.env.example` as
 * documented placeholders and are validated by the phase that needs them —
 * validating unused secrets now would be dishonest "fail fast" and block a
 * green dev startup on secrets the app doesn't use.
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
