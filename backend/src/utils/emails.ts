import { logger } from './logger.js';
import { ResendEmailSender } from './resend-email.js';

/**
 * Transactional-email seam (Auth-Design §6.5, §7.2, §14.2).
 *
 * The service layer sends through the `EmailSender` interface; `ConsoleEmailSender`
 * is the development/test transport. In production a provider (Postmark, SES, ...)
 * implements the same interface — the service is transport-agnostic.
 *
 * Security: tokens are never written to the pino log. pino's global redaction
 * covers keys named `token`, but a URL *containing* a token is not key-redacted,
 * so the console transport prints the clickable link only to stdout when
 * `printLinks` is on (dev/test). Structured logs carry only the purpose, never
 * the token, email, or destination URL.
 */

export interface VerificationEmailInput {
  to: string;
  token: string;
  redirectTo: string;
}

export interface PasswordResetEmailInput {
  to: string;
  token: string;
  resetUrl: string;
}

export interface EmailSender {
  sendVerificationEmail(input: VerificationEmailInput): Promise<void>;
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
}

/** The confirmation link a user opens to complete signup (Auth-Design §6.5). */
export function buildVerificationUrl(
  apiPublicOrigin: string,
  token: string,
  redirectTo: string,
): string {
  const params = new URLSearchParams({
    token,
    redirect_to: redirectTo,
  });
  return `${apiPublicOrigin}/auth/verify-email?${params.toString()}`;
}

export interface ConsoleEmailSenderOptions {
  /** Public origin of this API — the prefix of the confirmation link. */
  apiPublicOrigin: string;
  /** Print clickable links to stdout (dev/test). Defaults to true. */
  printLinks?: boolean;
}

export class ConsoleEmailSender implements EmailSender {
  private readonly apiPublicOrigin: string;
  private readonly printLinks: boolean;

  constructor(options: ConsoleEmailSenderOptions) {
    this.apiPublicOrigin = options.apiPublicOrigin;
    this.printLinks = options.printLinks ?? true;
  }

  async sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
    const url = buildVerificationUrl(this.apiPublicOrigin, input.token, input.redirectTo);
    logger.info(
      { kind: 'email', purpose: 'email_verification' },
      'verification email queued (console transport)',
    );
    if (this.printLinks) {
      console.log(`[dev-email] verification for ${input.to}:\n${url}\n`);
    }
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    logger.info(
      { kind: 'email', purpose: 'password_reset' },
      'password reset email queued (console transport)',
    );
    if (this.printLinks) {
      console.log(`[dev-email] password reset for ${input.to}:\n${input.resetUrl}\n`);
    }
  }
}

export { ResendEmailSender, type ResendEmailSenderOptions } from './resend-email.js';

/**
 * Factory creating the configured EmailSender for runtime (Milestone 14).
 * Returns ResendEmailSender if EMAIL_PROVIDER=resend and RESEND_API_KEY is present,
 * otherwise falls back safely to ConsoleEmailSender.
 */
export function createDefaultEmailSender(
  envConfig: {
    EMAIL_PROVIDER?: 'console' | 'resend';
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    API_PUBLIC_ORIGIN?: string;
    NODE_ENV?: string;
  } = {},
): EmailSender {
  const provider = envConfig.EMAIL_PROVIDER ?? 'console';
  const apiKey = envConfig.RESEND_API_KEY;
  const origin = envConfig.API_PUBLIC_ORIGIN ?? 'http://localhost:3000';
  const from = envConfig.EMAIL_FROM ?? 'TrainMate <noreply@trainmate.in>';
  const isProd = (envConfig.NODE_ENV ?? 'development') === 'production';

  if (provider === 'resend' && apiKey && apiKey.trim().length > 0) {
    return new ResendEmailSender({
      apiKey,
      apiPublicOrigin: origin,
      from,
    });
  }

  return new ConsoleEmailSender({
    apiPublicOrigin: origin,
    printLinks: !isProd,
  });
}
