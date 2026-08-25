import { logger } from './logger.js';
import { AppError } from './errors.js';
import {
  buildVerificationUrl,
  type EmailSender,
  type PasswordResetEmailInput,
  type VerificationEmailInput,
} from './emails.js';

export interface ResendEmailSenderOptions {
  apiKey: string;
  apiPublicOrigin: string;
  from?: string;
  /** Injectable fetch for unit tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Production transactional email sender powered by Resend (Milestone 14).
 *
 * Implements the standard `EmailSender` interface using Resend's HTTPS REST API.
 * Preserves strict privacy invariants: raw tokens and recipient emails are never
 * written to logs. In non-production or when RESEND_API_KEY is unset, the application
 * gracefully falls back to `ConsoleEmailSender`.
 */
export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly apiPublicOrigin: string;
  private readonly from: string;
  private readonly fetch: typeof fetch;

  constructor(options: ResendEmailSenderOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error('ResendEmailSender requires a valid API key');
    }
    this.apiKey = options.apiKey.trim();
    this.apiPublicOrigin = options.apiPublicOrigin;
    this.from = options.from || 'TrainMate <noreply@trainmate.in>';
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  async sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
    const url = buildVerificationUrl(this.apiPublicOrigin, input.token, input.redirectTo);

    logger.info(
      { kind: 'email', purpose: 'email_verification', provider: 'resend' },
      'dispatching verification email via Resend',
    );

    const subject = 'Confirm your TrainMate email';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; padding: 24px; color: #111827;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e5e7eb;">
    <h2 style="color: #111827; margin-top: 0;">Welcome to TrainMate!</h2>
    <p style="color: #4b5563; font-size: 16px; line-height: 24px;">
      Thanks for signing up. Please confirm your email address by clicking the button below:
    </p>
    <div style="margin: 32px 0;">
      <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 16px; display: inline-block;">
        Confirm Email Address
      </a>
    </div>
    <p style="color: #6b7280; font-size: 14px; line-height: 20px;">
      If you did not create an account, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 12px;">
      Or copy and paste this link into your browser:<br>
      <span style="word-break: break-all; color: #6b7280;">${url}</span>
    </p>
  </div>
</body>
</html>
    `.trim();

    const text = `Welcome to TrainMate!\n\nPlease confirm your email address by opening the following link in your browser:\n\n${url}\n\nIf you did not sign up for TrainMate, you can ignore this message.`;

    await this.postEmail({
      to: input.to,
      subject,
      html,
      text,
    });
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    logger.info(
      { kind: 'email', purpose: 'password_reset', provider: 'resend' },
      'dispatching password reset email via Resend',
    );

    const subject = 'Reset your TrainMate password';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; padding: 24px; color: #111827;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e5e7eb;">
    <h2 style="color: #111827; margin-top: 0;">Reset Your Password</h2>
    <p style="color: #4b5563; font-size: 16px; line-height: 24px;">
      We received a request to reset your TrainMate password. Click the button below to choose a new password:
    </p>
    <div style="margin: 32px 0;">
      <a href="${input.resetUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 16px; display: inline-block;">
        Reset Password
      </a>
    </div>
    <p style="color: #6b7280; font-size: 14px; line-height: 20px;">
      If you did not request a password reset, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
    `.trim();

    const text = `Reset your TrainMate password\n\nOpen the following link to choose a new password:\n\n${input.resetUrl}\n\nIf you did not request a reset, you can ignore this message.`;

    await this.postEmail({
      to: input.to,
      subject,
      html,
      text,
    });
  }

  private async postEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    try {
      const response = await this.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error');
        logger.error(
          {
            kind: 'email',
            provider: 'resend',
            status: response.status,
            error: errorBody,
          },
          'failed to send email via Resend API',
        );
        throw new AppError(502, 'EMAIL_SEND_FAILED', 'Failed to send transactional email');
      }

      logger.info(
        { kind: 'email', provider: 'resend', status: response.status },
        'transactional email successfully delivered to Resend API',
      );
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error(
        {
          kind: 'email',
          provider: 'resend',
          err: err instanceof Error ? err.message : String(err),
        },
        'unexpected network error sending email via Resend',
      );
      throw new AppError(502, 'EMAIL_SEND_FAILED', 'Failed to send transactional email');
    }
  }
}
