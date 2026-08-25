import { describe, expect, it, vi } from 'vitest';
import { ResendEmailSender } from '../../src/utils/resend-email.js';
import { ConsoleEmailSender, createDefaultEmailSender } from '../../src/utils/emails.js';
import { AppError } from '../../src/utils/errors.js';

describe('ResendEmailSender', () => {
  it('throws if API key is missing or empty', () => {
    expect(
      () =>
        new ResendEmailSender({
          apiKey: '',
          apiPublicOrigin: 'http://localhost:3000',
        }),
    ).toThrow(/requires a valid API key/);

    expect(
      () =>
        new ResendEmailSender({
          apiKey: '   ',
          apiPublicOrigin: 'http://localhost:3000',
        }),
    ).toThrow(/requires a valid API key/);
  });

  it('successfully sends verification email with correct headers and payload', async () => {
    let capturedUrl: string | undefined;
    let capturedOptions: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      capturedUrl = url;
      capturedOptions = options;
      return new Response(JSON.stringify({ id: 'resend_email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sender = new ResendEmailSender({
      apiKey: 're_test_key_12345',
      apiPublicOrigin: 'https://api.trainmate.in',
      from: 'TrainMate <noreply@trainmate.in>',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await sender.sendVerificationEmail({
      to: 'passenger@example.com',
      token: 'raw_test_token_abc',
      redirectTo: 'https://trainmate.in/dashboard',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe('https://api.resend.com/emails');
    expect(capturedOptions?.method).toBe('POST');
    expect(capturedOptions?.headers).toEqual({
      Authorization: 'Bearer re_test_key_12345',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.from).toBe('TrainMate <noreply@trainmate.in>');
    expect(body.to).toEqual(['passenger@example.com']);
    expect(body.subject).toBe('Confirm your TrainMate email');
    expect(body.html).toContain(
      'https://api.trainmate.in/auth/verify-email?token=raw_test_token_abc',
    );
    expect(body.text).toContain(
      'https://api.trainmate.in/auth/verify-email?token=raw_test_token_abc',
    );
  });

  it('successfully sends password reset email with correct payload', async () => {
    let capturedOptions: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      capturedOptions = options;
      return new Response(JSON.stringify({ id: 'resend_email_456' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sender = new ResendEmailSender({
      apiKey: 're_test_key_12345',
      apiPublicOrigin: 'https://api.trainmate.in',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await sender.sendPasswordResetEmail({
      to: 'passenger@example.com',
      token: 'raw_reset_token_xyz',
      resetUrl: 'https://trainmate.in/reset-password?token=raw_reset_token_xyz',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(capturedOptions?.body as string);
    expect(body.to).toEqual(['passenger@example.com']);
    expect(body.subject).toBe('Reset your TrainMate password');
    expect(body.html).toContain('https://trainmate.in/reset-password?token=raw_reset_token_xyz');
    expect(body.text).toContain('https://trainmate.in/reset-password?token=raw_reset_token_xyz');
  });

  it('throws AppError(502, EMAIL_SEND_FAILED) if Resend responds with an error status', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ message: 'Invalid API Key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sender = new ResendEmailSender({
      apiKey: 'invalid_key',
      apiPublicOrigin: 'https://api.trainmate.in',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      sender.sendVerificationEmail({
        to: 'passenger@example.com',
        token: 'token',
        redirectTo: 'https://trainmate.in',
      }),
    ).rejects.toThrowError(AppError);
  });

  it('throws AppError(502, EMAIL_SEND_FAILED) on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection timeout'));

    const sender = new ResendEmailSender({
      apiKey: 're_test_key',
      apiPublicOrigin: 'https://api.trainmate.in',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      sender.sendVerificationEmail({
        to: 'passenger@example.com',
        token: 'token',
        redirectTo: 'https://trainmate.in',
      }),
    ).rejects.toThrowError(AppError);
  });
});

describe('createDefaultEmailSender factory', () => {
  it('returns ResendEmailSender when EMAIL_PROVIDER=resend and RESEND_API_KEY is present', () => {
    const sender = createDefaultEmailSender({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_key_123',
      API_PUBLIC_ORIGIN: 'https://api.trainmate.in',
      EMAIL_FROM: 'TrainMate <noreply@trainmate.in>',
    });

    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it('falls back to ConsoleEmailSender when EMAIL_PROVIDER=console', () => {
    const sender = createDefaultEmailSender({
      EMAIL_PROVIDER: 'console',
      RESEND_API_KEY: 're_test_key_123',
      API_PUBLIC_ORIGIN: 'https://api.trainmate.in',
    });

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });

  it('falls back to ConsoleEmailSender when RESEND_API_KEY is missing even if EMAIL_PROVIDER=resend', () => {
    const sender = createDefaultEmailSender({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: '',
      API_PUBLIC_ORIGIN: 'https://api.trainmate.in',
    });

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });
});
